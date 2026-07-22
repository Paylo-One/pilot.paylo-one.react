import type { LegalSection } from "./terms-content";
import { COMPANY_DETAILS } from "@/lib/company";

export const PRIVACY_VERSION = "2026-07-22.1";
export const PRIVACY_EFFECTIVE_DATE = "22 July 2026";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "information-we-collect",
    heading: "1. Information We Collect",
    paragraphs: [
      `This Privacy Policy explains how ${COMPANY_DETAILS.legalName}, registered with the Dutch Chamber of Commerce (KvK) under number ${COMPANY_DETAILS.kvkNumber} ("we", "us", or "our"), collects, uses, and protects information when you use the Paylo.one service (the "Service"). It applies to information processed through your account and the workspaces you belong to.`,
      "We collect information in three main ways: information you provide directly, such as your account details and uploaded content; information ingested from third-party sources that you explicitly connect to your workspace; and information generated automatically when you use the Service, such as usage and device data.",
      "The Service is multi-tenant. Information belonging to one workspace is logically isolated from other workspaces, and access to a workspace is limited to its members. The categories of information we collect are described in more detail in the sections below.",
    ],
  },
  {
    id: "account-information",
    heading: "2. Account Information",
    paragraphs: [
      "When you create an account, we collect your name, email address, and authentication details. If you sign in using a third-party identity provider, we receive the profile information that the provider shares with us, such as your name and email address.",
      "If you purchase a paid subscription, our payment processor collects billing information such as your payment method and billing address. We do not store full payment card numbers on our own systems.",
      "We also keep records of your workspace memberships, roles, and account settings so that we can provide the Service to you and the workspaces you belong to.",
    ],
  },
  {
    id: "connected-source-data",
    heading: "3. Connected Source Data",
    paragraphs: [
      "The Service can ingest data from third-party sources such as email accounts, calendars, GitHub, WhatsApp, and Notion. We only ingest data from a source after you have explicitly connected and approved that source for your workspace. We do not access or collect data from any source you have not connected.",
      "Depending on the sources you connect, ingested data may include emails and message content, calendar events, contacts, documents, code repository activity, and associated metadata such as senders, recipients, and timestamps. This data may include personal information about you and about third parties who communicate with you.",
      "Credentials and session tokens used to access connected sources are encrypted at rest and stored server-side only. They are never exposed to your browser or to other users, and they are used exclusively to retrieve data from the sources you have authorised. You can disconnect a source at any time, after which we stop ingesting new data from it.",
    ],
  },
  {
    id: "uploaded-files-and-user-content",
    heading: "4. Uploaded Files and User Content",
    paragraphs: [
      "You may upload files, notes, and other content to your workspace. We store this content, along with extracted text and metadata, so that the Service can index it, search it, and include it in briefings and suggested actions.",
      "Uploaded content remains within the workspace it was uploaded to and is subject to tenant isolation. You and the members of your workspace control what is uploaded and can delete uploaded content at any time.",
    ],
  },
  {
    id: "usage-data",
    heading: "5. Usage Data",
    paragraphs: [
      "When you use the Service, we automatically collect technical and usage information, including your IP address, browser type, device and operating system information, pages and features used, timestamps, and error and performance logs.",
      "We use this information to operate, secure, and improve the Service, including detecting abuse, diagnosing problems, and understanding how features are used. Where practical, usage data is aggregated or pseudonymised before being used for analytics.",
    ],
  },
  {
    id: "cookies-and-similar-technologies",
    heading: "6. Cookies and Similar Technologies",
    paragraphs: [
      "We use cookies and similar technologies to keep you signed in, remember your preferences, protect against cross-site request forgery, and understand how the Service is used. Essential cookies are required for the Service to function and cannot be disabled while using the Service.",
      "Where we use non-essential cookies, such as analytics cookies, we will request your consent where required by applicable law. You can manage cookies through your browser settings, although disabling essential cookies may prevent parts of the Service from working.",
    ],
  },
  {
    id: "how-we-use-information",
    heading: "7. How We Use Information",
    paragraphs: [
      "We use the information described in this policy for the following purposes:",
      "Where data protection law applies to our processing, we rely on the performance of our contract with you, our legitimate interests in operating and securing the Service, your consent where required, and compliance with our legal obligations as lawful bases for processing.",
    ],
    bullets: [
      "To provide the Service, including ingesting connected-source data, storing your content, and generating briefings and suggested actions.",
      "To create and manage your account, workspaces, and subscriptions, and to process payments.",
      "To secure the Service, including authentication, fraud and abuse prevention, and enforcement of tenant isolation.",
      "To communicate with you about the Service, including service announcements, security notices, and support responses.",
      "To improve the Service, diagnose issues, and develop new features, using aggregated or pseudonymised data where practical.",
      "To comply with legal obligations and to establish, exercise, or defend legal claims.",
    ],
  },
  {
    id: "ai-processing",
    heading: "8. AI Processing",
    paragraphs: [
      "The Service uses artificial intelligence to analyse the content in your workspace and to generate briefings, summaries, and suggested actions. AI processing operates on your workspace data, including connected-source data and uploaded content, solely to provide these features to you and your workspace members.",
      "Where AI processing is performed by third-party model providers acting as our subprocessors, we send only the data necessary for the requested operation, under contractual terms that restrict the provider from using your data for any purpose other than providing the service to us. We do not use your workspace content to train generalised AI models without your explicit consent.",
      "AI-generated outputs may be inaccurate or incomplete and are not professional advice. Outputs are stored within your workspace alongside the data they were generated from and are subject to the same isolation, retention, and deletion rules.",
    ],
  },
  {
    id: "data-sharing-and-subprocessors",
    heading: "9. Data Sharing and Subprocessors",
    paragraphs: [
      "We do not sell your personal information. We share information only as described in this policy.",
      `We use a limited set of service providers (subprocessors) to operate the Service, such as cloud hosting and storage providers, AI model providers, payment processors, and email delivery services. Subprocessors are bound by contracts that require them to protect your information and to process it only on our instructions. A current list of subprocessors is available on request at ${COMPANY_DETAILS.accessEmail}.`,
      "We may also disclose information where required by law, legal process, or a binding governmental request; where necessary to protect the rights, safety, or property of our users, the public, or ourselves; or in connection with a merger, acquisition, or sale of assets, in which case we will notify you of any change in ownership or in the use of your personal information.",
    ],
  },
  {
    id: "third-party-integrations",
    heading: "10. Third-Party Integrations",
    paragraphs: [
      "When you connect a third-party source, you authorise that provider to share data with us and, in some cases, authorise us to perform actions through the provider on your behalf. Each provider's own privacy policy governs its handling of your data, and we encourage you to review those policies.",
      "We access connected sources using the permissions you grant during the connection process and request only the scopes needed for the features you use. You can revoke access at any time, either within the Service or through the third-party provider's own settings.",
      "We are not responsible for the privacy practices of third-party providers. Disconnecting a source stops new ingestion, but data already ingested into your workspace remains there until you delete it or your workspace is deleted.",
    ],
  },
  {
    id: "google-api-data",
    heading: "11. Google API Data",
    paragraphs: [
      "When you connect a Google account, you authorise the Service to access your Google account email address, Gmail messages and labels, and Google Calendar calendars and events through Google application programming interfaces (APIs). We request read-only access. You choose which discovered Gmail labels and calendars to activate, and we ingest content only from those active sources.",
      "We use Google user data to provide features that you request and that appear in the Service, including connected-source views, private briefings, summaries, context, and suggested actions. We may use artificial intelligence to process selected Google user data solely to provide these features to you and your workspace members.",
      "We encrypt Google OAuth credentials and store them server-side. We store ingested Google user data and derived outputs in your tenant-isolated workspace, subject to the security, retention, and deletion practices described in this policy.",
      "We may transfer only the Google user data necessary to our contracted infrastructure and artificial intelligence subprocessors to provide the user-facing features you request. We do not sell Google user data or use it for advertising, credit decisions, or training generalised artificial intelligence models. Our personnel do not read Google user data unless you give affirmative permission for specific data, access is necessary for security purposes, or the law requires it.",
      `Disconnecting Google deletes the stored Google OAuth credentials and stops new ingestion. You can also revoke the Service's access through your Google Account settings. Data already ingested remains in your workspace until you delete the relevant content or workspace, or ask us to delete it by contacting ${COMPANY_DETAILS.accessEmail}.`,
      "The Service's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
    ],
  },
  {
    id: "data-retention",
    heading: "12. Data Retention",
    paragraphs: [
      "We retain your account information for as long as your account is active and for a reasonable period afterwards as needed to comply with our legal obligations, resolve disputes, and enforce our agreements.",
      "Workspace content, including connected-source data, uploaded files, and AI-generated outputs, is retained while the workspace exists. When you delete content, disconnect a source and delete its data, or delete a workspace, the corresponding data is removed from our active systems within a reasonable period and from backups in accordance with our backup rotation cycle.",
      "Usage logs and security records are retained for limited periods appropriate to their purpose, after which they are deleted or anonymised.",
    ],
  },
  {
    id: "data-security",
    heading: "13. Data Security",
    paragraphs: [
      "We implement technical and organisational measures designed to protect your information against unauthorised access, alteration, disclosure, and destruction. These measures include encryption of data in transit and at rest, tenant isolation between workspaces, role-based access controls, and logging and monitoring of access to production systems.",
      "Credentials and session tokens for connected sources are encrypted and held server-side only; they are never sent to the browser. Access to production data by our personnel is restricted to what is necessary to operate and support the Service.",
      "No method of transmission or storage is completely secure, and we cannot guarantee absolute security. If we become aware of a personal data breach affecting your information, we will notify you and the relevant authorities where required by applicable law.",
    ],
  },
  {
    id: "international-transfers",
    heading: "14. International Transfers",
    paragraphs: [
      "Your information may be processed and stored in countries other than the one in which you live, including countries that may have different data protection laws than your jurisdiction.",
      "Where we transfer personal information internationally, we use appropriate safeguards recognised by applicable law, such as standard contractual clauses or transfers to jurisdictions with an adequacy decision, and we require our subprocessors to do the same.",
    ],
  },
  {
    id: "your-rights",
    heading: "15. Your Rights",
    paragraphs: [
      "Depending on your jurisdiction, you may have rights regarding your personal information, which may include the following:",
      `You can exercise many of these rights directly within the Service, for example by editing your account details, deleting content, or disconnecting sources. For other requests, contact us at ${COMPANY_DETAILS.accessEmail}. We will respond within the timeframes required by applicable law and may need to verify your identity before acting on a request. If you are unsatisfied with our response, you may have the right to lodge a complaint with a data protection authority.`,
    ],
    bullets: [
      "The right to access the personal information we hold about you.",
      "The right to correct inaccurate or incomplete information.",
      "The right to delete your personal information.",
      "The right to receive a copy of your information in a portable format.",
      "The right to restrict or object to certain processing, including processing based on legitimate interests.",
      "The right to withdraw consent at any time, where processing is based on consent.",
    ],
  },
  {
    id: "childrens-privacy",
    heading: "16. Children's Privacy",
    paragraphs: [
      "The Service is not directed at children and may not be used by anyone under the age of 16, or the minimum age required in your jurisdiction to consent to use online services.",
      `We do not knowingly collect personal information from children. If we become aware that we have collected personal information from a child without appropriate consent, we will delete it promptly. If you believe a child has provided us with personal information, please contact us at ${COMPANY_DETAILS.accessEmail}.`,
    ],
  },
  {
    id: "changes-to-this-policy",
    heading: "17. Changes to This Policy",
    paragraphs: [
      "We may update this Privacy Policy from time to time to reflect changes to the Service, our practices, or applicable law. The version identifier and effective date at the top of this policy indicate the current revision.",
      "If we make material changes, we will notify you by email or through the Service before the changes take effect. Your continued use of the Service after an updated policy takes effect constitutes your acknowledgement of the updated policy.",
    ],
  },
  {
    id: "contact",
    heading: "18. Contact",
    paragraphs: [
      `If you have questions about this Privacy Policy or about how we handle your information, you can contact ${COMPANY_DETAILS.legalName} at ${COMPANY_DETAILS.accessEmail} or by post at ${COMPANY_DETAILS.postalAddress}. ${COMPANY_DETAILS.legalName} is registered with the Dutch Chamber of Commerce under ${COMPANY_DETAILS.kvkLabel}.`,
      "Requests to exercise your privacy rights, requests for our current subprocessor list, and privacy-related complaints should be directed to the same contact details. We will respond as soon as reasonably practicable.",
    ],
  },
];
