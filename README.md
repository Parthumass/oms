# Pratyagra Operations Portal

A web portal for Pratyagra Education Foundation: students, volunteers, classes, attendance, assessments,
volunteer training, events and reports, with a separate login for every person.

Built with React (Vite) on Supabase (Postgres + login). It is a static site, so it can be hosted free.

## Who sees what

| Role | Access |
|---|---|
| Admin | Everything, including Setup (centres, programs, partners) and Logins |
| Board | All records, read and write. No Setup or Logins |
| Centre Lead | Everything for one centre |
| Volunteer | Only the classes assigned to them and the students in those classes. Never family or contact details |
| Partner | Read-only attendance and assessments for the centres or programs listed under Setup > Partners > Access |

These rules are enforced in the database (`supabase/schema.sql`, row-level security), not just in the screens.
Someone who signs up without being approved sees a "Waiting for access" page and no data.

**One person, two roles.** Each login has one main role. An admin, board member or centre lead who also teaches
can be linked to their volunteer record under **Logins** (the *Volunteer record* field). The same login then also
gets a **My training** page and counts as that volunteer for hours, training and feedback. Being centre lead of two
centres on one login is not supported.

## How people get a login

1. An admin approves an email under **Logins > Approved emails** (any role), or a centre lead clicks
   **Give login** next to a volunteer.
2. That person opens the portal, chooses **Create your login**, and signs up with the same email.
3. They confirm their email from the link Supabase sends, then sign in. The role is applied automatically.

Marking a volunteer **Inactive** switches their login off.

## Attendance

Pick a class and a month. Each class date is a column. Click a box to cycle: **X** (present), **AB** (absent), blank.
Click a date heading for topics covered, a substitute volunteer, or to fill all blanks at once.
A substitute can mark only the date they were named on.

## Training

- **Trainings** is the catalogue. The admin team adds a training (name, what it covers, a link to the material).
- **Assign** chooses which volunteers have to do it. Centre leads can assign and tick off their own volunteers
  (volunteers whose *Home centre* is their centre).
- **Tracker** shows every volunteer against every training: not assigned, To do, or Done. Click to change.
- **Sessions** are live meetings. If a session is linked to a training, everyone marked present is recorded as
  having completed that training.
- Volunteers see their own list, with due dates and material links, and can leave feedback on sessions they attended.

## One-time setup

1. **Database.** In a new Supabase project, open SQL Editor, paste `supabase/schema.sql`, and run it.
   Then run each file in `supabase/migrations/` in order.
2. **Keep "Confirm email" switched on** (Authentication > Sign In / Providers > Email). The approval system relies on it:
   with it off, anyone who knows an approved email could claim that login.
3. **Set up your own email sender** (Authentication > Emails > SMTP Settings). Supabase's built-in sender only
   delivers to members of your Supabase team and allows 2 emails an hour, so volunteers would never get their
   confirmation link. Any SMTP account works, for example a pratyagra.org mailbox or a free Resend or Brevo account.
4. **Site URL** (Authentication > URL Configuration): set it to the address where the portal is hosted, and add the
   same address under Redirect URLs.
5. **First admin.** In SQL Editor run, with your own email:
   ```sql
   insert into public.invites (email, role) values ('you@pratyagra.org', 'admin');
   ```
   Then create your login in the portal with that email.
6. In the portal, open **Setup** and add centres, programs, partners and the names of the five core trainings.

## Hosting

The project URL and publishable key are in `.env.production`. Both are safe to publish; access is controlled by
the database rules. Never put the Supabase **secret** key or database password in this repository.

- **Cloudflare Pages / Vercel / Netlify:** connect the GitHub repository. Build command `npm run build`,
  output folder `dist`. `public/_redirects` and `vercel.json` already send every path to the app.
- The logo is `public/logo.jpg`. Replace that file to change it.
- If the site is served from a sub-folder (GitHub Pages serves a repository at `/repo-name/`), build with
  `VITE_BASE=/repo-name/ npm run build`.

## Running it on your computer

```bash
npm install
cp .env.production .env.local   # point local runs at the project
npm run dev
```

## Things to know on Supabase's free plan

- A project with no activity for a week is paused. Open the dashboard and press Restore, or sign in to the portal
  weekly during holidays.
- There are no automatic backups. Export the data regularly (Database > Backups is paid; use Table Editor export
  or `pg_dump`). This is children's data, so decide who is responsible for it.

## Where things are

- `supabase/schema.sql` : tables, access rules, report views
- `supabase/migrations/` : later database changes, run in order after `schema.sql`
- `supabase/tests/` : checks that each role sees only what it should
- `src/pages/` : one file per screen
- `src/components/Crud.tsx` : the shared list-and-form used by most screens
- `src/lib/auth.tsx` : sign-in state and the current person's role
