# Access-rule tests

These check, against a plain local Postgres, that each role can see and change only what it should .
Run them after any change to `schema.sql`.

```bash
createdb pef
psql -d pef -f local-shim.sql      # stands in for Supabase's auth schema and roles
psql -d pef -f ../schema.sql
for f in ../migrations/*.sql; do psql -d pef -f "$f"; done
psql -d pef -f seed.sql
./run.sh                           # edit the psql connection at the top if yours differs
```

Expected last line ends with `failed=0`.
