-- Reviewed photo vocabulary + non-degree language programmes only.
-- No content publication, source import, identity rewrite, or permission change.
BEGIN;
DO $migration$
DECLARE
 definition TEXT;
 signature TEXT;
 old_photo CONSTANT TEXT := $old$value->>'photoKey' IN ('sunway','mmu','xjtlu','unnc','taylors','inti','ucsi','xiamen-malaysia','monash-malaysia','scut','zjut','gdut','upc-east-china','ecust')$old$;
 new_photo CONSTANT TEXT := $new$value->>'photoKey' IN ('academy-of-arts-architecture-and-design-in-prague','agh-university-of-krakow','ankara-university','apu','australian-performing-arts-conservatory','bahcesehir-university','beijing-institute-of-technology-zhuhai-bit-zhuhai','beijing-language-and-culture-university','beijing-normal-university','bilkent-university','bocconi-university','bogazici-university','brno-university-of-technology','ca-foscari-university-of-venice','chang-an-university','charles-university','china-jiliang-university','city-malaysia','communication-university-of-zhejiang','cyprus-university-of-technology','czech-technical-university-ctu','czech-university-of-life-sciences-prague-czu','east-china-normal-university','eastern-mediterranean-university','ecole-de-management-applique','ecust','european-university-cyprus','frederick-university','fudan-university','gbs-global-banking-school-dubai-campus','gbs-he-malta','gdut','guangdong-university-of-foreign-studies','guangzhou-huashang-vocational-college','hangzhou-city-university','hangzhou-normal-university-hznu','harbin-institute-of-technology-hit','harbin-institute-of-technology-shenzhen','huazhong-university-of-science-and-technology-hust','hubei-university-of-arts-and-science','icn-business-school','inti','istanbul-ayd-n-university','istanbul-teknik-universitesi-itu','istanbul-university','iulm-university','jagiellonian-university','koc-university','kozminski-university','krakow-university-of-economics-uniwersytet-ekonomiczny-w-krakowie','masaryk-university','medical-university-of-gdansk','medical-university-of-warsaw','middle-east-technical-university-metu-odtu','mla-college','mmu','monash-malaysia','msu','nanchang-university','nanjing-university','near-east-university','northwestern-polytechnical-university','ocean-university-of-china-ouc','peking-university','politecnico-di-milano','politecnico-di-torino','poznan-university-of-technology','prague-college','sabanc-university','sapienza-university-of-rome','schiller-international-university','scuola-politecnica-di-design','scut','shanghai-international-studies-university','shanghai-jiao-tong-university','shanghai-normal-university','shanghai-university','shenyang-aerospace-university','southwest-university','southwestern-university-of-finance-and-economics','sunway','taylors','technical-university-of-liberec','tongji-university','tongmyong-university','tsinghua-university','uclan-cyprus','ucsi','unikl','universita-cattolica-del-sacro-cuore','university-of-bergamo','university-of-bologna','university-of-brescia','university-of-calabria','university-of-camerino','university-of-cassino-and-southern-lazio','university-of-catania','university-of-chemistry-and-technology-prague-vscht','university-of-cyprus','university-of-economics-prague-vse','university-of-electronic-science-and-technology-of-china-uestc','university-of-florence','university-of-genoa','university-of-insubria','university-of-macerata','university-of-messina','university-of-milan-bicocca','university-of-milan-universita-degli-studi-di-milano-statale','university-of-naples-federico-ii','university-of-nicosia','university-of-padova','university-of-palermo','university-of-parma','university-of-pavia-universita-degli-studi-di-pavia','university-of-perugia','university-of-pisa','university-of-rome-tor-vergata','university-of-science-and-technology-of-china-ustc','university-of-shanghai-for-science-and-technology','university-of-siena','university-of-trento','university-of-turin','university-of-verona','university-of-vienna-universitat-wien','university-of-warsaw','university-of-wroc-aw','unnc','upc-east-china','upm','utm','vistula-university-uczelnia-vistula','warsaw-university-of-technology','wuhan-university','xi-an-international-studies-university','xiamen-malaysia','xidian-university','xjtlu','yeditepe-university','yibin-university','zhejiang-gongshang-university','zhejiang-international-studies-university','zhejiang-sci-tech-university','zhejiang-university','zjut')$new$;
 old_levels CONSTANT TEXT := $old$('foundation','diploma','bachelor','master','doctorate')$old$;
 new_levels CONSTANT TEXT := $new$('foundation','diploma','bachelor','master','doctorate','language')$new$;
BEGIN
 SELECT pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,old_photo)=0 OR strpos(substr(definition,strpos(definition,old_photo)+length(old_photo)),old_photo)>0 THEN
  RAISE EXCEPTION 'University photo validator source changed; review migration 151 before applying';
 END IF;
 EXECUTE replace(definition,old_photo,new_photo);
 FOREACH signature IN ARRAY ARRAY[
  'platform_private.valid_university_content(jsonb)',
  'platform_private.university_catalog_page(uuid,text,text,text,uuid,integer)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  IF strpos(definition,old_levels)=0 OR strpos(substr(definition,strpos(definition,old_levels)+length(old_levels)),old_levels)>0 THEN
   RAISE EXCEPTION 'University level validator source changed; review migration 151 before applying';
  END IF;
  -- CREATE OR REPLACE preserves the owner/ACL and all unchanged validation.
  EXECUTE replace(definition,old_levels,new_levels);
 END LOOP;
END $migration$;
COMMIT;
