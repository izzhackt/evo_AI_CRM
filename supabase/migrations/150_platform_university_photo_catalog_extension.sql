-- Extend only the reviewed campus-photo enum. No publication, data import,
-- permissions, source-registry scope, or existing published content changes.
BEGIN;
DO $migration$
DECLARE
 definition TEXT;
 old_check CONSTANT TEXT := $old$value->>'photoKey' IN ('sunway','mmu','xjtlu','unnc')$old$;
 new_check CONSTANT TEXT := $new$value->>'photoKey' IN ('sunway','mmu','xjtlu','unnc','taylors','inti','ucsi','xiamen-malaysia','monash-malaysia','scut','zjut','gdut','upc-east-china','ecust')$new$;
BEGIN
 SELECT pg_get_functiondef('platform_private.valid_university_content(jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,old_check)=0 OR strpos(substr(definition,strpos(definition,old_check)+length(old_check)),old_check)>0 THEN
  RAISE EXCEPTION 'University photo validator source changed; review migration 150 before applying';
 END IF;
 -- CREATE OR REPLACE preserves the existing owner/ACL and all other validation.
 EXECUTE replace(definition,old_check,new_check);
END $migration$;
COMMIT;
