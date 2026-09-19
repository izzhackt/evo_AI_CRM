#!/usr/bin/env python3
"""Stream-check real downloaded ZIP bytes against its manifest and source inventory.
No extraction or content logging. Optionally decrypt protected envelopes in memory.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile
from inventory import private_output, write_json


def digest(stream):
    value=hashlib.sha256(); size=0
    while chunk:=stream.read(8*1024*1024): value.update(chunk); size+=len(chunk)
    return value.hexdigest(),size

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--archive',required=True); parser.add_argument('--inventory',required=True)
    parser.add_argument('--report',required=True); parser.add_argument('--require-all',action='store_true')
    parser.add_argument('--verify-protected',action='store_true'); parser.add_argument('--sops',default='/opt/homebrew/bin/sops')
    args=parser.parse_args()
    rows=[json.loads(line) for line in Path(args.inventory).read_text().splitlines() if line.strip()]
    expected={r['relativePath']:r for r in rows if r['status']=='hashed'}
    root=Path(rows[0]['sourceRoot']); output=private_output(Path(args.report).absolute(),root)
    covered=set(); errors=[]; verified=0; encrypted_records=0; child_env=None
    if args.verify_protected:
        result=subprocess.run(['security','find-generic-password','-s','EVO Secrets Age Key','-a',os.environ['USER'],'-w'],capture_output=True)
        if result.returncode: raise RuntimeError('key_unavailable')
        child_env={**os.environ,'SOPS_AGE_KEY':result.stdout.decode().strip()}
    with zipfile.ZipFile(args.archive) as archive:
        names=archive.namelist()
        if len(names)!=len(set(names)): raise RuntimeError('duplicate_zip_paths')
        if any(n.startswith('/') or '..' in n.split('/') for n in names): raise RuntimeError('unsafe_zip_path')
        if archive.getinfo('Манифест.json').file_size>100*1024*1024: raise RuntimeError('manifest_too_large')
        manifest=json.loads(archive.read('Манифест.json'))
        for item in manifest['materials']:
            if item['kind']=='folder': continue
            path=item['path']; info=archive.getinfo(path)
            with archive.open(info) as stream: sha,size=digest(stream)
            if sha!=item['sha256'] or (item.get('byteSize') is not None and size!=item['byteSize']):
                errors.append({'path':path,'error':'export_bytes_mismatch'});continue
            verified+=1
            source=item.get('source') or {}; original_path=item.get('originalPath') or path
            relative=source.get('relativePath')
            if relative in expected:
                with archive.open(original_path) as stream: original_sha,original_size=digest(stream)
                if (original_sha,original_size)!=(expected[relative]['sha256'],expected[relative]['bytes']):
                    errors.append({'path':original_path,'error':'source_bytes_mismatch'})
                else: covered.add(relative)
            if item['area']=='secrets' and child_env is not None:
                if info.file_size>40*1024*1024: raise RuntimeError('protected_envelope_too_large')
                result=subprocess.run([args.sops,'decrypt','--input-type','json','--output-type','json'],input=archive.read(info),capture_output=True,env=child_env)
                if result.returncode:
                    errors.append({'path':path,'error':'protected_decrypt_failed'});continue
                value=json.loads(result.stdout)
                if item['kind']=='secret':
                    if not all(isinstance(value.get(k),str) for k in ('service','url','login','purpose','note','value')): errors.append({'path':path,'error':'protected_record_invalid'})
                    else: encrypted_records+=1
                elif value.get('format')==1 and value.get('kind')=='file':
                    original=base64.b64decode(value['data'],validate=True); relative=value['relativePath']
                    actual=(hashlib.sha256(original).hexdigest(),len(original))
                    if relative not in expected or actual!=(expected[relative]['sha256'],expected[relative]['bytes']): errors.append({'path':path,'error':'protected_original_mismatch'})
                    else: covered.add(relative)
                else: errors.append({'path':path,'error':'protected_envelope_invalid'})
    report={'format':1,'archive':str(Path(args.archive).resolve()),'inventorySha256':hashlib.sha256(Path(args.inventory).read_bytes()).hexdigest(),
            'zipFilesVerified':verified,'encryptedRecordsVerified':encrypted_records,'sourceOriginalsVerified':len(covered),
            'expectedOriginals':len(expected),'retainedKeyFiles':len(rows)-len(expected),'missingOriginals':sorted(set(expected)-covered),'errors':errors,
            'complete':not errors and covered==set(expected)}
    write_json(output,report)
    print(json.dumps({k:report[k] for k in ('zipFilesVerified','encryptedRecordsVerified','sourceOriginalsVerified','expectedOriginals','retainedKeyFiles','complete')}))
    if errors or (args.require_all and not report['complete']): raise SystemExit(2)

if __name__=='__main__':
    try: main()
    except Exception as error: raise SystemExit('export_verification_failed:'+type(error).__name__) from None
