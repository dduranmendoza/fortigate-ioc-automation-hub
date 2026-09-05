/**
 * FortiGate IoC Automation Hub
 * Google Forms / Sheets + Apps Script + Google Chat
 *
 * Public reference implementation. Review and adapt before production use.
 */

const CONFIG = {
  OUTPUT_COLUMN: 8,
  NOTIFICATION_SHEET: 'Config_Notifications',
  CHAT_WEBHOOK_PROPERTY: 'GOOGLE_CHAT_WEBHOOK_URL',

  OBJECT_PREFIX: 'IOC_',
  GROUP_PREFIX: 'GRP_IOC_',
  MASTER_GROUP: 'GRP_BLOCK_IOC',

  DEFAULT_NOTIFICATION_EMAIL: 'soc-notifications@example.com'
};

const PROTECTED_IPS = {
  '8.8.8.8': 'Google Public DNS',
  '8.8.4.4': 'Google Public DNS',
  '1.1.1.1': 'Cloudflare DNS',
  '1.0.0.1': 'Cloudflare DNS',
  '9.9.9.9': 'Quad9 DNS',
  '149.112.112.112': 'Quad9 DNS',
  '127.0.0.1': 'Loopback',
  '0.0.0.0': 'Unspecified address'
};

const PROTECTED_DOMAINS = [
  'google.com', 'microsoft.com', 'office.com', 'office365.com',
  'cloudflare.com', 'amazonaws.com', 'github.com',
  'fortinet.com', 'fortiguard.com'
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Notification Management')
    .addItem('👁️ View recipients', 'showNotificationRecipients')
    .addItem('➕ Add recipient', 'addNotificationRecipient')
    .addItem('➖ Remove recipient', 'removeNotificationRecipient')
    .addToUi();
}

function getNotificationSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.NOTIFICATION_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.NOTIFICATION_SHEET);
    sheet.getRange('A1').setValue('Notification recipients').setFontWeight('bold');
    sheet.getRange('A2').setValue(CONFIG.DEFAULT_NOTIFICATION_EMAIL);
    sheet.hideSheet();
  }
  return sheet;
}

function getNotificationRecipients() {
  const sheet = getNotificationSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .flat()
    .map(v => String(v).trim().toLowerCase())
    .filter(isValidEmail);
}

function showNotificationRecipients() {
  const recipients = getNotificationRecipients();
  SpreadsheetApp.getUi().alert(
    'Notification recipients',
    recipients.length ? '• ' + recipients.join('\n• ') : 'No recipients configured.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function addNotificationRecipient() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('Add recipient', 'Email address:', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const email = response.getResponseText().trim().toLowerCase();
  if (!isValidEmail(email)) {
    ui.alert('Invalid email address.');
    return;
  }

  const recipients = getNotificationRecipients();
  if (recipients.includes(email)) {
    ui.alert('Recipient already exists.');
    return;
  }

  getNotificationSheet().appendRow([email]);
  ui.alert('Recipient added.');
}

function removeNotificationRecipient() {
  const ui = SpreadsheetApp.getUi();
  const recipients = getNotificationRecipients();
  if (!recipients.length) {
    ui.alert('No recipients configured.');
    return;
  }

  const response = ui.prompt(
    'Remove recipient',
    'Enter the exact address to remove:\n\n• ' + recipients.join('\n• '),
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const target = response.getResponseText().trim().toLowerCase();
  const sheet = getNotificationSheet();
  for (let row = sheet.getLastRow(); row >= 2; row--) {
    if (String(sheet.getRange(row, 1).getValue()).trim().toLowerCase() === target) {
      sheet.deleteRow(row);
      ui.alert('Recipient removed.');
      return;
    }
  }
  ui.alert('Recipient not found.');
}

/**
 * Installable spreadsheet trigger: From spreadsheet -> On form submit.
 */
function onFormSubmit(e) {
  if (!e || !e.range) throw new Error('This function must run from an installable form-submit trigger.');

  const sheet = e.range.getSheet();
  const row = e.range.getRow();

  // Expected columns:
  // B Ticket | C Change/RFC | D Detail | E FQDN/URLs | F IP/Subnets | H Generated CLI
  const ticket = cleanSingleLine(sheet.getRange(row, 2).getDisplayValue());
  const changeId = cleanSingleLine(sheet.getRange(row, 3).getDisplayValue());
  const detail = cleanSingleLine(sheet.getRange(row, 4).getDisplayValue());
  const fqdnInput = sheet.getRange(row, 5).getDisplayValue();
  const ipInput = sheet.getRange(row, 6).getDisplayValue();

  if (!ticket) throw new Error('Ticket/incident ID is required.');

  const parsed = parseIoCs(`${fqdnInput}\n${ipInput}`);
  const cli = generateFortiGateCli(ticket, changeId, parsed.fqdns, parsed.ips);

  sheet.getRange(row, CONFIG.OUTPUT_COLUMN).setValue(cli);

  try {
    sendGoogleChatNotification({
      ticket,
      changeId,
      detail,
      processed: [...parsed.fqdns, ...parsed.ips],
      omitted: parsed.omitted
    });
  } catch (err) {
    console.error('Google Chat notification failed:', err);
  }

  sendEmailNotification({ticket, changeId, detail, cli, omitted: parsed.omitted});
}

function parseIoCs(rawText) {
  const normalized = undefang(String(rawText || ''));
  const tokens = normalized.split(/[\n,\s]+/).map(v => v.trim()).filter(Boolean);

  const ips = new Set();
  const fqdns = new Set();
  const omitted = [];

  tokens.forEach(token => {
    if (token.includes('@')) return;

    const ipCandidate = extractIpOrCidr(token);
    if (ipCandidate && isValidIpv4OrCidr(ipCandidate)) {
      const hostIp = ipCandidate.split('/')[0];
      if (PROTECTED_IPS[hostIp]) {
        omitted.push(`${ipCandidate} (${PROTECTED_IPS[hostIp]})`);
      } else {
        ips.add(ipCandidate);
      }
      return;
    }

    const domain = extractDomain(token);
    if (!domain) return;

    if (isProtectedDomain(domain)) {
      omitted.push(`${domain} (protected domain)`);
    } else {
      fqdns.add(domain);
    }
  });

  return {
    ips: [...ips].sort(),
    fqdns: [...fqdns].sort(),
    omitted: [...new Set(omitted)]
  };
}

function undefang(text) {
  return text
    .replace(/hxxps?:\/\//gi, match => match.toLowerCase().startsWith('hxxps') ? 'https://' : 'http://')
    .replace(/\[\.\]/g, '.')
    .replace(/\(\.\)/g, '.')
    .replace(/\[at\]/gi, '@');
}

function extractIpOrCidr(value) {
  const match = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/);
  return match ? match[0] : null;
}

function isValidIpv4OrCidr(value) {
  const [ip, cidr] = value.split('/');
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (cidr !== undefined && (!/^\d+$/.test(cidr) || Number(cidr) < 0 || Number(cidr) > 32)) return false;
  return true;
}

function extractDomain(value) {
  let candidate = value
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase()
    .replace(/^[.]+|[.]+$/g, '');

  if (!candidate.includes('.') || candidate.length > 253) return null;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(candidate)) return null;
  return candidate;
}

function isProtectedDomain(domain) {
  return PROTECTED_DOMAINS.some(base => domain === base || domain.endsWith('.' + base));
}

function generateFortiGateCli(ticket, changeId, fqdns, ips) {
  const safeTicket = safeFortiString(ticket);
  const safeChange = safeFortiString(changeId);
  const groupSuffix = normalizeName(ticket);
  const groupName = `${CONFIG.GROUP_PREFIX}${groupSuffix}`;
  const members = [];
  const lines = ['config firewall address'];

  fqdns.forEach(fqdn => {
    const objectName = `${CONFIG.OBJECT_PREFIX}${normalizeName(fqdn)}`;
    lines.push(
      `    edit "${objectName}"`,
      '        set type fqdn',
      `        set fqdn "${safeFortiString(fqdn)}"`,
      `        set comment "Block request ${safeTicket}"`,
      '    next'
    );
    members.push(`"${objectName}"`);
  });

  ips.forEach(ip => {
    const objectName = `${CONFIG.OBJECT_PREFIX}${normalizeName(ip)}`;
    const subnet = ip.includes('/') ? cidrToSubnetCommand(ip) : `${ip} 255.255.255.255`;
    lines.push(
      `    edit "${objectName}"`,
      `        set comment "Block request ${safeTicket}"`,
      `        set subnet ${subnet}`,
      '    next'
    );
    members.push(`"${objectName}"`);
  });

  lines.push('end', '');

  if (members.length) {
    lines.push(
      'config firewall addrgrp',
      `    edit "${groupName}"`,
      `        set member ${members.join(' ')}`
    );
    if (safeChange) lines.push(`        set comment "${safeChange}"`);
    lines.push(
      '    next',
      '',
      `    edit "${CONFIG.MASTER_GROUP}"`,
      `        append member "${groupName}"`,
      '    next',
      'end'
    );
  }

  return lines.join('\n');
}

function cidrToSubnetCommand(cidr) {
  const [ip, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const mask = [0, 8, 16, 24].map(shift => {
    const bits = Math.max(0, Math.min(8, prefix - shift));
    return bits === 0 ? 0 : 256 - Math.pow(2, 8 - bits);
  });
  return `${ip} ${mask.join('.')}`;
}

function sendGoogleChatNotification(data) {
  const webhook = PropertiesService.getScriptProperties().getProperty(CONFIG.CHAT_WEBHOOK_PROPERTY);
  if (!webhook) throw new Error(`Missing Script Property: ${CONFIG.CHAT_WEBHOOK_PROPERTY}`);

  let text = `🚨 *NEW FORTIGATE IOC CLI GENERATED*\n\n` +
    `• *Ticket:* ${data.ticket}\n` +
    `• *Change / RFC:* ${data.changeId || 'N/A'}\n` +
    `• *Detail:* ${data.detail || 'N/A'}\n`;

  if (data.omitted.length) {
    text += `\n⚠️ *ALLOWLIST — OMITTED:*\n• ${data.omitted.join('\n• ')}\n`;
  }

  text += `\n*IoCs processed:*\n\`${data.processed.length ? data.processed.join(', ') : 'None'}\``;

  const response = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({text}),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 300) {
    throw new Error(`Google Chat returned HTTP ${response.getResponseCode()}`);
  }
}

function sendEmailNotification(data) {
  const recipients = getNotificationRecipients();
  if (!recipients.length) return;

  let warning = '';
  if (data.omitted.length) {
    warning = 'ALLOWLIST — OMITTED FOR SAFETY:\n• ' + data.omitted.join('\n• ') + '\n\n';
  }

  const subject = `[SOC - IoC] FortiGate CLI generated - ${data.ticket}`;
  const body = `A new IoC blocking request has been processed.\n\n` +
    `Ticket: ${data.ticket}\n` +
    `Change / RFC: ${data.changeId || 'N/A'}\n` +
    `Detail: ${data.detail || 'N/A'}\n\n` +
    warning +
    `FORTIGATE CLI\n${'-'.repeat(50)}\n${data.cli}\n${'-'.repeat(50)}\n\n` +
    `Automated message generated by FortiGate IoC Automation Hub.`;

  MailApp.sendEmail(recipients.join(','), subject, body);
}

function normalizeName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function safeFortiString(value) {
  return String(value || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/["\\]/g, '')
    .trim()
    .slice(0, 180);
}

function cleanSingleLine(value) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

/**
 * Run once from the Apps Script editor to request MailApp permissions.
 */
function authorizePermissions() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Permission test', 'OK');
}
