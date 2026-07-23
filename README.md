# Joshua – Precision Lighting Update

## Upload these replacement files
Replace `server.js` and `prompt.js`, and keep your existing secret environment-variable values.

## What changed
- New service and job-update calls route to Ariana: 972-904-4736.
- Quotes, estimates, pricing, proposals, and new projects route to Travis: 214-243-5649.
- Accounting routes to Shellie: 972-904-4735, then Ariana if Shellie does not answer.
- Notification emails go only to Travis@ThePrecisionLighting.com.
- Operations and Accounting notification email recipients were removed.
- Email subjects and email/SMS summaries begin with a large, unmistakable call-reason banner.
- Exact, unique incoming-number matches may be greeted by first name.
- Shared, duplicate, blocked, and uncertain numbers are never greeted by name.

## Contact-list format
Export business contacts as CSV and copy them into `contacts.csv`.

Required columns:
- `first_name`
- `phone`

Optional columns:
- `last_name`
- `company`
- `email`
- `service_address`
- `shared_number`
- `notes`

Set `shared_number` to `true` for company main lines, family/shared phones, or any number that should not receive a personalized greeting.

## Important
Do not upload `.env.example` over your live `.env`. It contains blank placeholders, not your credentials.
After deployment, call `/health` to verify the server is online.
The home route `/` reports how many unique confirmed contacts were loaded.
