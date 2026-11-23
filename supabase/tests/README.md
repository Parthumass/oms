# Access-rule tests

These check, against a plain local Postgres, that each role can see and change only what it should (80 checks).
Run them after any change to `schema.sql`.

```bash
createdb pef
psql -d pef -f local-shim.sql      # stands in for Supabase's auth schema and roles
psql -d pef -f ../schema.sql
psql -d pef -f seed.sql
./run.sh                           # edit the psql connection at the top if yours differs
```

Expected last line: `passed=80 failed=0`.
