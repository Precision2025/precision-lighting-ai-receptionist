# Precision Lighting AI Receptionist — Faith

Faith is a deployable telephone receptionist built for Precision Lighting. It uses:

- Twilio Programmable Voice and ConversationRelay for phone calls, speech recognition, voice synthesis, interruptions, and transfers
- OpenAI for natural conversation and post-call summaries
- Optional Microsoft 365 SMTP email and Twilio SMS notifications

## What is already configured

- Precision Lighting's phone numbers and dispatch email
- Commercial and residential service intake
- Work-order, store/site, NTE, access, IVR, deadline, and scope questions
- Electrical emergency safety response
- Live transfer to 214-243-5649 by default
- No unauthorized pricing, scheduling, warranty, refund, or job-status promises
- Complaint, billing, applicant, vendor, and national-account handling
- Email/SMS summaries after calls

## What you need

1. A Twilio account with a voice-capable number
2. ConversationRelay enabled in Twilio's Voice AI/ML settings
3. An OpenAI API key
4. A public HTTPS host that supports WebSockets, such as Render
5. Optional Microsoft 365 app password for emailed summaries

## Fastest deployment: Render

1. Unzip this project and place it in a private GitHub repository.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Add the secret environment variables from `.env.example`.
4. Set `PUBLIC_BASE_URL` to the final Render URL, for example:
   `https://precision-lighting-receptionist.onrender.com`
5. Deploy.
6. Confirm that `/health` returns `{"ok":true}`.

A paid always-on Render plan is recommended for production phone answering. A sleeping free service can delay or miss calls.

## Twilio setup

1. In Twilio Console, accept the Predictive and Generative AI/ML Features Addendum under Voice settings.
2. Buy or select a voice-capable Twilio number.
3. Open that number's Voice configuration.
4. Set **A call comes in** to **Webhook**.
5. Use:
   `https://YOUR-HOST/voice`
6. Method: `HTTP POST`.
7. Save and call the Twilio number.

Faith's WebSocket is generated automatically as:
`wss://YOUR-HOST/ws`

## Use your existing Precision Lighting number

Keep advertising your current number. Ask the current phone carrier to configure **conditional call forwarding / forward on no answer** to the Twilio number.

Recommended behavior:

- Ring the office or your cell for 15–20 seconds
- If unanswered, forward to Faith
- Forward directly to Faith after hours

Do not forward Faith's transfer destination back to the same forwarding number, or the call can loop. The default transfer destination is 214-243-5649. Change `LIVE_TRANSFER_NUMBER` if that number will forward back to Faith.

## Email summaries

The `.env.example` file is prefilled for Microsoft 365 SMTP:

- Host: `smtp.office365.com`
- Port: `587`
- Secure: `false`
- Recipient: `Dispatch@theprecisionlighting.com`

Use an app password or SMTP credential that is permitted by the Microsoft 365 tenant. If SMTP is not configured, summaries remain visible in the server logs.

## SMS summaries

Set both:

- `SUMMARY_SMS_TO`
- `TWILIO_SMS_FROM`

`TWILIO_SMS_FROM` must be an SMS-capable Twilio number authorized for the destination.

## Change Faith's behavior

Edit `src/prompt.js`. Business logic and safety rules are separated from the call transport so the script can be changed without rebuilding the telephone flow.

## Local check

```bash
cp .env.example .env
npm install
npm run check
npm start
```

For real calls, Twilio must reach the app over public HTTPS/WSS. Localhost alone will not work.

## Important production notes

- Call recording is not enabled.
- Faith identifies herself as a virtual receptionist.
- The application does not collect payment-card data.
- Twilio signature validation is enabled by default.
- Review applicable call-recording, privacy, AI disclosure, and telemarketing laws before adding recording or outbound calling.
