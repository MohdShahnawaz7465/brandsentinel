# Privacy and accessibility

## Privacy: what happens to a draft

| Where | What is stored or sent |
|---|---|
| Your browser (`localStorage`) | Your drafts, version history, source library and settings. Never leaves the browser unless you sign in and save a draft. |
| Your browser tab (`sessionStorage`) | The sign-in token and name of your workspace. Gone when the tab closes. |
| BrandSentinel server | Only when you are signed in: your account, workspace, saved drafts and their history. Drafts belong to one workspace and are not visible to other workspaces. |
| The AI provider | Only the sentences the fixed rules could not judge, after redaction, with the brand sources attached. Nothing else. |
| Files you upload | Word, PDF and picture files are read inside your browser. They are not uploaded. Only the text you then check can reach the AI step. |

**Redaction.** Before any sentence is sent to the AI, emails, phone numbers and the workspace's confidential names are replaced with placeholders in the browser, and the server does it again.

**The receipt.** After every run, "What left our system" lists which sentences (and how many characters) went to which provider, what was hidden, which sources were attached and which AI suggestions were blocked. It can be downloaded as JSON. If the fixed rules handled everything, it says nothing was sent.

**Control.** A workspace admin can switch the AI step off for the whole workspace. The server enforces it for signed-in members. Using "Continue in this browser only" stores nothing on the server.

**Passwords** are stored only as salted PBKDF2-SHA256 hashes (200,000 rounds). The AI key and database address exist only as hosting environment variables.

**Third parties that see a visitor's address.** When the page loads, fonts come from Google Fonts and, on first use, the Word, PDF and OCR libraries come from cdnjs and jsDelivr. These servers can see the visitor's IP address as with any website. The text of a draft is not sent to them.

**Not provided:** encryption of drafts beyond what the database host does, a password reset, and a data export or deletion screen. Demo data is shared and must not contain private text.

## Accessibility

BrandSentinel checks other people's copy for accessibility (missing image alt text, vague link text such as "click here", colour contrast against WCAG, colours outside the brand palette). That is a feature of the product, not a claim about the interface itself.

**What the interface already does (read from the code):**
- Every form field has a visible label; sign-in fields declare `autocomplete`.
- Tabs expose the current page (`aria-current`), the sign-in tabs expose `aria-selected`.
- Visible keyboard focus outline on every control.
- Highlighted phrases in the draft can be opened with Enter or Space.
- Light and dark theme that follow the system setting, with a Theme button.
- The layout works at phone width.
- Animations are turned off for people who ask for reduced motion.
- Status is never colour only: severity is also written as a word ("high", "medium", "low").

**What we have not done:** a screen-reader test, an automated audit with a tool such as axe or Lighthouse, and a measured contrast check of our own colours. Treat the list above as intent, not certification. If a check is run before submission, record the result here.

| Check | Result |
|---|---|
| Keyboard only: sign in, review, apply a fix, submit | not yet run |
| Screen reader (NVDA or VoiceOver) | not yet run |
| Lighthouse accessibility score (live page) | not yet run |