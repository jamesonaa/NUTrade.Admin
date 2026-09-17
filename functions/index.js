/**
 * NUTrade Admin Portal - Firebase Cloud Functions
 * sendAdminSecurityCode: Callable function that sends the 6-digit
 * admin security code to the registered admin email via Gmail SMTP.
 *
 * Secrets required (set via Firebase CLI):
 *   firebase functions:secrets:set GMAIL_USER
 *   firebase functions:secrets:set GMAIL_APP_PASS
 */

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");

// Firebase Secrets — values are injected at runtime, never exposed in code
const GMAIL_USER     = defineSecret("GMAIL_USER");
const GMAIL_APP_PASS = defineSecret("GMAIL_APP_PASS");

/**
 * Callable function: sendAdminSecurityCode
 *
 * Request payload:
 *   { email: string, code: string }
 *
 * Returns:
 *   { success: true } or throws HttpsError
 */
exports.sendAdminSecurityCode = onCall(
  {
    secrets: [GMAIL_USER, GMAIL_APP_PASS],
    // Restrict to authenticated callers only
    enforceAppCheck: false,
  },
  async (request) => {
    // 1. Auth guard — caller must be authenticated via Firebase Auth
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Only authenticated admin users may request a security code."
      );
    }

    const { email, code } = request.data || {};

    // 2. Validate inputs
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "A valid email address is required.");
    }

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw new HttpsError("invalid-argument", "A valid 6-digit numeric code is required.");
    }

    // 3. Confirm the caller's UID email matches the target email (extra safety)
    const callerEmail = request.auth.token.email;
    if (callerEmail && callerEmail.toLowerCase() !== email.toLowerCase()) {
      throw new HttpsError(
        "permission-denied",
        "Security code may only be sent to the authenticated admin email."
      );
    }

    // 4. Create Nodemailer transporter using Gmail SMTP + App Password
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER.value(),
        pass: GMAIL_APP_PASS.value(),
      },
    });

    // 5. Compose the security code email
    const mailOptions = {
      from: `"NUTrade Admin Security" <${GMAIL_USER.value()}>`,
      to: email,
      subject: "🔐 Your NUTrade Admin Security Code",
      text: `Your NUTrade Admin security code is: ${code}\n\nThis code expires in 3 minutes. Do not share it with anyone.\n\nIf you did not request this, please contact system support immediately.`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; font-family: 'Segoe UI', Arial, sans-serif; background: #F4F6F8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow: 0 4px 24px rgba(0,43,91,0.10);">

          <!-- Header -->
          <tr>
            <td style="background: #002B5B; padding: 28px 36px; text-align:center;">
              <div style="display:inline-block; background: #D4A017; color:#002B5B; font-weight:800; font-size:1rem; letter-spacing:0.1em; padding: 4px 14px; border-radius:6px; margin-bottom:10px;">ADMIN</div>
              <div style="color:#FFFFFF; font-size:1.35rem; font-weight:700; letter-spacing:-0.01em;">NUTrade Admin Portal</div>
              <div style="color:rgba(255,255,255,0.6); font-size:0.82rem; margin-top:4px;">Marketplace Administration • National University Lipa</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 36px 12px;">
              <div style="text-align:center; margin-bottom:20px;">
                <div style="display:inline-flex; align-items:center; justify-content:center; width:52px; height:52px; border-radius:12px; background:rgba(212,160,23,0.10); border:1.5px solid rgba(212,160,23,0.35);">
                  🔐
                </div>
              </div>
              <h1 style="font-size:1.2rem; font-weight:800; color:#002B5B; text-align:center; margin:0 0 8px;">Admin Security Verification</h1>
              <p style="font-size:0.88rem; color:#64748B; text-align:center; margin:0 0 28px; line-height:1.5;">
                A security verification was requested for <strong style="color:#002B5B;">${email}</strong>.<br/>
                Use the 6-digit code below to access the Admin Console.
              </p>

              <!-- Code Box -->
              <div style="background:#F8FAFC; border:2px solid #002B5B; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
                <div style="font-size:0.72rem; font-weight:700; color:#002B5B; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:10px;">Your Security Code</div>
                <div style="font-family: 'Courier New', Courier, monospace; font-size:2.4rem; font-weight:900; letter-spacing:0.35em; color:#002B5B;">${code}</div>
                <div style="font-size:0.75rem; color:#94A3B8; margin-top:10px;">⏱ Expires in <strong>3 minutes</strong></div>
              </div>

              <div style="background:#FFF9EC; border-left:3px solid #D4A017; border-radius:0 8px 8px 0; padding:12px 16px; margin-bottom:24px;">
                <div style="font-size:0.78rem; color:#78350F; font-weight:600;">⚠ Security Notice</div>
                <div style="font-size:0.76rem; color:#92400E; margin-top:4px; line-height:1.5;">
                  This code was generated automatically. Do not share it with anyone. It will expire in 3 minutes and cannot be reused.
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC; border-top:1px solid #E2E8F0; padding:18px 36px; text-align:center;">
              <div style="font-size:0.72rem; color:#94A3B8; line-height:1.6;">
                NUTrade Admin Portal &bull; National University Lipa &bull; Automated Security Email<br/>
                If you did not request this, please contact the system administrator immediately.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    };

    // 6. Send the email
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[NUTrade] Security code email sent to ${email}`);
      return { success: true };
    } catch (sendError) {
      console.error("[NUTrade] Failed to send security code email:", sendError);
      throw new HttpsError(
        "internal",
        "Failed to send security code email. Please try again or contact support."
      );
    }
  }
);
