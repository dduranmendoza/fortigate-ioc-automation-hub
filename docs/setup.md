# Setup

## 1. Create the input form

Create a Google Form with the following logical fields:

1. Incident / ticket ID
2. Change / RFC ID
3. IoC justification / detail
4. Domains / FQDNs / URLs
5. IPv4 addresses / CIDR subnets

Link the form to a Google Sheet.

The reference implementation expects these values in columns **B–F** of the response sheet and writes generated CLI to column **H**. If your form differs, update the column references in `onFormSubmit()` and `CONFIG.OUTPUT_COLUMN`.

## 2. Add the Apps Script code

From the response spreadsheet:

**Extensions → Apps Script**

Copy the contents of:

- `src/Code.gs`
- `src/appsscript.json`

## 3. Configure the Google Chat webhook securely

Create an incoming webhook in the destination Google Chat space.

Do **not** paste the webhook URL into source code.

In Apps Script:

**Project Settings → Script Properties → Add script property**

```text
Property: GOOGLE_CHAT_WEBHOOK_URL
Value:    https://chat.googleapis.com/...
```

If a webhook has ever been committed or shared publicly, rotate it before using the repository.

## 4. Create the installable trigger

In Apps Script, open **Triggers → Add Trigger** and select:

```text
Function:        onFormSubmit
Deployment:      Head
Event source:    From spreadsheet
Event type:      On form submit
```

Authorize the requested Sheets, Mail and external-request permissions.

## 5. Configure email recipients

Reload the response Sheet. A custom menu named **Notification Management** appears.

Use it to add or remove notification recipients. They are stored in the hidden `Config_Notifications` sheet.

For a public fork, change:

```javascript
DEFAULT_NOTIFICATION_EMAIL: 'soc-notifications@example.com'
```

before your first execution.

## 6. Adapt the naming taxonomy

The default public convention is:

```text
IoC object:      IOC_<normalized-indicator>
Request group:   GRP_IOC_<ticket>
Master group:    GRP_BLOCK_IOC
```

Change these values in `CONFIG` to match your organization's naming standard.

## 7. Review the safety allowlist

`PROTECTED_IPS` and `PROTECTED_DOMAINS` are intentionally small examples. Define your own protected services and business-critical domains before production use.

Do not treat a static allowlist as your only safety control. Your existing change-management and review process should remain authoritative.

## 8. Test with documentation-only indicators

Use the included `examples/sample-input.txt`. It relies on `.invalid` domains and RFC 5737 documentation ranges so no real malicious infrastructure is required.

Expected behavior:

- defanged values are normalized;
- duplicate indicators are removed;
- protected values are omitted;
- FortiGate CLI is written to the response Sheet;
- Google Chat receives a summary;
- configured recipients receive the CLI by email.

## Production considerations

Before production use, consider adding:

- organization-specific authorization controls;
- immutable audit logging outside the editable Sheet;
- a formal approval state before deployment;
- change IDs tied to your ITSM system;
- rate limiting / queueing if request volume increases;
- unit tests for parser and naming rules;
- deployment verification through FortiGate events or Automation Stitches.
