#!/usr/bin/env python3
"""Seal original vault files and structured records locally. No plaintext output.
Uses the existing macOS Keychain age key, held in child environment/stdin only.
Original files and private key backups are never modified or copied to the bundle.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
from inventory import private_output, write_json

LABELS = {
 'EVO_GMAIL_LOGIN':'Gmail — логин', 'EVO_GMAIL_APP_PASSWORD':'Gmail — пароль приложения',
 'EVO_GOOGLE_OAUTH_CLIENT_ID':'Google — идентификатор приложения', 'EVO_GOOGLE_OAUTH_CLIENT_SECRET':'Google — секрет приложения',
 'EVO_AMOCRM_SUBDOMAIN':'amoCRM — адрес аккаунта', 'EVO_AMOCRM_CLIENT_ID':'amoCRM — идентификатор приложения',
 'EVO_AMOCRM_CLIENT_SECRET':'amoCRM — секрет приложения', 'EVO_AMOCRM_REDIRECT_URI':'amoCRM — адрес возврата',
 'EVO_AMOCRM_ACCESS_TOKEN':'amoCRM — токен доступа', 'EVO_AMOCRM_REFRESH_TOKEN':'amoCRM — токен обновления',
 'EVO_SUPABASE_URL':'Supabase — адрес проекта', 'EVO_SUPABASE_ANON_KEY':'Supabase — публичный ключ',
 'EVO_SUPABASE_SERVICE_ROLE_KEY':'Supabase — сервисный ключ', 'EVO_SUPABASE_DATABASE_URL':'Supabase — подключение к базе',
 'EVO_SUPABASE_DATABASE_PASSWORD':'Supabase — пароль базы', 'EVO_WAHA_API_KEY':'WAHA — ключ API',
 'EVO_WAHA_WEBHOOK_SECRET':'WAHA — секрет вебхука', 'EVO_GEMINI_API_KEY':'Gemini — ключ API',
 'EVO_GITHUB_TOKEN':'GitHub — токен', 'EVO_DNS_API_TOKEN':'DNS — токен API',
}

def command(args, *, content=None, env=None):
    result = subprocess.run(args, input=content, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise RuntimeError('protected_tool_failed')  # No provider error fragments or plaintext.
    return result.stdout

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--plan',required=True); parser.add_argument('--output-dir',required=True)
    parser.add_argument('--sops',default='/opt/homebrew/bin/sops'); parser.add_argument('--age-keygen',default='/opt/homebrew/bin/age-keygen')
    args=parser.parse_args()
    plan=json.loads(Path(args.plan).read_text()); root=Path(plan['sourceRoot']).resolve(strict=True)
    directory=Path(args.output_dir).absolute()
    manifest=private_output(directory/'План защищённого переноса.json',root)
    directory.mkdir(mode=0o700,parents=True,exist_ok=True); directory.chmod(0o700)
    key=command(['security','find-generic-password','-s','EVO Secrets Age Key','-a',os.environ['USER'],'-w']).strip()
    recipient=command([args.age_keygen,'-y'],content=key+b'\n').decode().strip()
    child_env={**os.environ,'SOPS_AGE_KEY':key.decode()}
    def crypt(operation, data, input_type='json'):
        cli=[args.sops,operation,'--input-type',input_type,'--output-type','json']
        if operation=='encrypt': cli+=['--age',recipient,'--filename-override','evo-knowledge.enc.json']
        return command(cli,content=data,env=child_env)
    entries=[]
    def seal(value, folders):
        filename=('Источник ' if value['kind']=='file' else 'Доступ ')+value['nodeId']+'.enc.json'
        target=private_output(directory/filename,root)
        if target.exists():
            cipher=target.read_bytes()
            if json.loads(crypt('decrypt',cipher))!=value: raise RuntimeError('protected_source_changed')
        else:
            cipher=crypt('encrypt',json.dumps(value,ensure_ascii=False).encode())
            if json.loads(crypt('decrypt',cipher))!=value: raise RuntimeError('protected_roundtrip_failed')
            descriptor, temporary=tempfile.mkstemp(prefix='.sealed-',dir=directory)
            try:
                with os.fdopen(descriptor,'wb') as stream:
                    stream.write(cipher); stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary,target)
                directory_fd=os.open(directory,os.O_RDONLY)
                try: os.fsync(directory_fd)
                finally: os.close(directory_fd)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
        entries.append({'id':value['nodeId'],'kind':value['kind'],'file':filename,'folders':folders,
                        'cipherSha256':hashlib.sha256(cipher).hexdigest(),'cipherBytes':len(cipher)})
    vaults=[]
    for row in plan['entries']:
        if row['action']!='protected_import': continue
        raw_source=root/row['relativePath']
        source=raw_source.resolve(strict=True)
        if not source.is_relative_to(root) or raw_source.is_symlink(): raise RuntimeError('protected_path_invalid')
        content=source.read_bytes()
        if len(content)!=row['bytes'] or hashlib.sha256(content).hexdigest()!=row['sha256']: raise RuntimeError('protected_source_changed')
        seal({'format':1,'kind':'file','sourceKey':row['sourceKey'],'nodeId':row['nodeId'],
              'title':source.name,'relativePath':row['relativePath'],'sha256':row['sha256'],
              'byteSize':len(content),'data':base64.b64encode(content).decode()},['Исходники сейфа',*row['folders']])
        if source.name.endswith('.enc.yaml'): vaults.append((row,json.loads(crypt('decrypt',content,'yaml'))))
    for row,vault in vaults:
        def record(identity,fields):
            node=str(uuid.uuid5(uuid.NAMESPACE_URL,'evo-sealed:'+row['sourceKey']+':'+identity))
            seal({'format':1,'kind':'record','nodeId':node,'fields':fields},['Доступы из локального сейфа'])
        for name,value in vault.get('env',{}).items():
            if not isinstance(value,str): raise RuntimeError('protected_record_shape_changed')
            record(name,{'service':LABELS.get(name,'Доступ — '+name),'url':'','login':'','purpose':name,
                         'note':'Перенесено из локального сейфа. Актуальность доступа не проверялась.','value':value})
        staff=vault.get('platform_staff_accounts',{})
        for index,member in enumerate(staff.get('members',[])):
            if not member.get('password'): continue
            record('staff:'+str(member.get('key',index)),{'service':'CRM — '+str(member.get('name') or member.get('title') or 'Сотрудник'),
              'url':staff.get('crmUrl',''),'login':member.get('login') or member.get('email',''),
              'purpose':'Вход сотрудника CRM','note':'Сохранённый доступ из локального сейфа; пароль не менялся.','value':member['password']})
    write_json(manifest,{'version':1,'format':'evo-protected-import-v1','inventorySha256':plan['inventorySha256'],'entries':entries})
    print(json.dumps({'sealedOriginals':sum(e['kind']=='file' for e in entries),'sealedRecords':sum(e['kind']=='record' for e in entries),
                      'cipherBytes':sum(e['cipherBytes'] for e in entries),'roundtripVerified':len(entries),'plaintextFilesWritten':0}))

if __name__=='__main__':
    try: main()
    except Exception as error:
        # Safe error class; exception strings may contain provider/source values.
        raise SystemExit('protected_prepare_failed:'+type(error).__name__) from None
