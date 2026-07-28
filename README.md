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

## O'Reilly ServiceChannel IVR by text

Joshua can now receive authorized text commands and call the saved ServiceChannel check-in number automatically.

Examples:

- `Check in 123456789`
- `CI 123456789`
- `Check out 123456789 complete 2 techs`
- `Check out 123456789 waiting for quote 1 tech`
- `Check out 123456789 parts needed 2 techs`
- `Check out 123456789 return trip needed 1 tech`
- Compact: `CO 123456789 1 2` (status 1, two technicians)

Checkout status mapping:

- 1 = Complete
- 2 = Waiting for authorization/quote
- 3 = Parts needed
- 4 = Return trip needed

### Twilio configuration

On Joshua's Twilio phone number, set **Messaging > A message comes in** to:

`https://YOUR-RENDER-URL/sms`

Method: `POST`

The outbound IVR status callback is handled automatically at `/servicechannel/ivr-status`.

### Required Render environment variables

Copy the values from `SERVICECHANNEL-ENV.txt` into Render. `SERVICECHANNEL_VOICE_FROM` must be a voice-capable Twilio number in your account. Keep `SERVICECHANNEL_PIN` private.

Only phone numbers in `SERVICECHANNEL_AUTHORIZED_NUMBERS`, plus configured Travis/Ariana/Shellie numbers, can run the IVR commands.

A completed phone call confirms that Twilio completed the call and sent the keypad sequence. It does not independently prove that ServiceChannel accepted every entry, so Joshua's completion text tells the sender to verify in ServiceChannel when confirmation is required.
