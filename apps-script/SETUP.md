# RSVP → Google Sheet setup (one time, ~5 minutes)

Guests fill in the RSVP page. Their answers go to **your private Google Sheet**. Guests can send answers, but they can never read them.

| Tab | What's in it |
|---|---|
| **Summary** | Live headcounts: total guests, Sangeet dancers, Haldi, Reception and Wedding numbers, rooms and pickups |
| **RSVPs** | One row per phone number holding the guest's **latest** answers. If they re-submit, their row is updated in place. |
| **History** | Every submission ever sent, never edited, so you can always see what changed |

## 1. Make the sheet and paste the script
1. Open <https://sheets.new> and name the sheet, e.g. `Wedding RSVPs`.
2. Click **Extensions → Apps Script**.
3. Delete the sample code, paste in everything from [`Code.gs`](Code.gs), and click **Save** 💾.
4. In the function dropdown at the top, pick **`setup`** and click **▶ Run**.
   Google asks for permission. Choose your account, then **Advanced → Go to … (unsafe)** → **Allow**.
   (It says "unsafe" only because you wrote the script yourself and Google hasn't reviewed it.)
   You'll now see the **Summary**, **RSVPs** and **History** tabs in the sheet.

## 2. Publish it as a web app
1. Click **Deploy → New deployment**. Click the ⚙️ next to "Select type" and choose **Web app**.
2. **Execute as:** `Me` · **Who has access:** `Anyone`. Then click **Deploy**.
   "Anyone" only lets people *send* an RSVP. The sheet itself stays private.
3. Copy the **Web app URL**. It ends in `/exec`.
4. To check it's live, open the URL in a browser. You should see `{"ok":true,"service":"wedding-rsvp"}`.

## 3. Connect the page
Paste the URL into [`config.js`](../config.js):

```js
window.RSVP_CONFIG = {
  scriptUrl: 'https://script.google.com/macros/s/AKfy…/exec',
};
```

Commit it, then open the RSVP page and send a test response. It should show up in **RSVPs** within a second or two.

## Good to know
- **Phone number is the guest's ID.** Same number = same row, so you always have their final answers. The page accepts only valid 10-digit Indian mobile numbers. `+91` and a leading `0` are stripped automatically.
- **Sharing:** share the Google Sheet (Viewer or Editor) with anyone who should see the list. Nobody else can.
- **Changing the script later:** use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same URL. A *New deployment* would create a new URL.
- Each question on the page that a guest wasn't shown is saved as blank. For example, non-dancers get no song, and people not coming both days get no accommodation answer.
