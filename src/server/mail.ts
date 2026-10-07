import nodemailer from "nodemailer";

// Using the project's existing Vite environment variable pattern
const GMAIL_USER = import.meta.env.MAIN_VITE_GMAIL_USER;
const GMAIL_PASS = import.meta.env.MAIN_VITE_GMAIL_APP_PASSWORD;

// Create the nodemailer transporter for Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

/**
 * Send a real email to anyone using your Gmail account.
 * You can call this anywhere in the main process (e.g., from AppController).
 */
export async function sendMail(toEmail: string, subject: string, text: string) {
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.warn("Gmail credentials are missing. Email not sent.");
    return { success: false, error: "Missing Gmail credentials in .env" };
  }

  try {
    const info = await transporter.sendMail({
      from: `"SMC Accounts App" <${GMAIL_USER}>`, // Sender name and your email
      to: toEmail,
      subject: subject,
      text: text,
    });
    console.log("Email sent successfully via Gmail! Message ID:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Failed to send email via Gmail:", error);
    return { success: false, error };
  }
}
