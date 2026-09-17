import * as React from "react";
import { Body, Button, Column, Container, Head, Heading, Html, Link, Preview, Row, Section, Text } from "react-email";

export type SubscriptionEmailProps = {
  kind: "invite" | "subscribe";
  url: string;
  expiresAt: string;
  siteUrl: string;
  inviterName?: string;
};

// The site's palette, so the email reads as the same publication as the pages it links to.
const colors = {
  ink: "#17201c",
  muted: "#5e6963",
  canvas: "#f4f3ed",
  surface: "#fafaf6",
  panel: "#e9e9e1",
  forest: "#173f32",
  forestDeep: "#0c2c22",
  mint: "#b7d7c1",
  line: "#dcdcd3"
};

const fontFamily = "Aptos, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const inside = [
  { title: "Top story", detail: "The week's most important development, and why it matters to Proterra." },
  { title: "More this week", detail: "Short summaries across dairy, meat, and bovine genetics." },
  { title: "Direct sources", detail: "Every story links to the original report." }
];

export function formatExpiry(expiresAt: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(expiresAt));
}

export function SubscriptionEmail({ kind, url, expiresAt, siteUrl, inviterName }: SubscriptionEmailProps) {
  const invite = kind === "invite";
  const heading = invite
    ? inviterName ? `${inviterName} invited you to the weekly digest` : "You're invited to the weekly digest"
    : "Confirm your subscription";
  const lead = invite
    ? "Proterra Intelligence is a weekly briefing on dairy, meat, and bovine genetics, reviewed from direct sources. Accept to start receiving it by email."
    : "You asked to receive the Proterra Intelligence weekly digest. Confirm this address and the next issue will arrive here.";
  const expiry = formatExpiry(expiresAt);

  return (
    <Html lang="en">
      <Head />
      <Preview>{invite ? `${inviterName ?? "Someone"} invited you to the Proterra Intelligence weekly digest.` : "Confirm your Proterra Intelligence subscription."}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={masthead}>
            <Row>
              <Column style={markColumn}>
                <Text style={mark}>PI</Text>
              </Column>
              <Column>
                <Text style={brandName}>Proterra Intelligence</Text>
                <Text style={brandDescriptor}>Dairy, meat, and bovine genetics</Text>
              </Column>
            </Row>
          </Section>

          <Section style={card}>
            <Heading as="h1" style={h1}>{heading}</Heading>
            <Text style={leadText}>{lead}</Text>
            <Button href={url} style={primaryButton}>{invite ? "Accept invitation" : "Confirm subscription"}</Button>
            <Text style={afterButton}>
              {invite
                ? "Not interested? Ignore this email and you won't be added. The invitation page also lets you decline."
                : "Didn't ask for this? Ignore this email and nothing changes."}
            </Text>

            <Section style={insideBox}>
              <Text style={insideTitle}>In each issue</Text>
              {inside.map((item) => (
                <Text key={item.title} style={insideRow}>
                  <span style={insideItem}>{item.title}</span>
                  <br />
                  {item.detail}
                </Text>
              ))}
            </Section>

            <Text style={finePrint}>
              This {invite ? "invitation" : "link"} works until {expiry}. It can only be used once.
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              <Link href={`${siteUrl}/`} style={footerLink}>Visit Proterra Intelligence</Link>
            </Text>
            <Text style={footerText}>
              {invite
                ? `You received this because ${inviterName ?? "someone"} entered your address on Proterra Intelligence.`
                : "You received this because your address was entered on Proterra Intelligence."}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = { margin: 0, padding: "24px 0", backgroundColor: colors.canvas, color: colors.ink, fontFamily };
const container: React.CSSProperties = { width: "100%", maxWidth: "560px", margin: "0 auto" };
const masthead: React.CSSProperties = { padding: "22px 28px", backgroundColor: colors.forestDeep, borderRadius: "16px 16px 0 0" };
const markColumn: React.CSSProperties = { width: "48px", verticalAlign: "middle" };
const mark: React.CSSProperties = { width: "36px", height: "36px", margin: 0, borderRadius: "18px", backgroundColor: colors.mint, color: colors.forestDeep, fontSize: "11px", fontWeight: 700, letterSpacing: "0.8px", lineHeight: "36px", textAlign: "center" };
const brandName: React.CSSProperties = { margin: 0, color: "#ffffff", fontSize: "15px", fontWeight: 700, lineHeight: "20px", letterSpacing: "-0.2px" };
const brandDescriptor: React.CSSProperties = { margin: 0, color: colors.mint, fontSize: "12px", lineHeight: "18px" };
const card: React.CSSProperties = { padding: "36px 28px 30px", backgroundColor: colors.surface, borderLeft: `1px solid ${colors.line}`, borderRight: `1px solid ${colors.line}` };
const h1: React.CSSProperties = { margin: "0 0 14px", color: colors.ink, fontSize: "30px", fontWeight: 600, lineHeight: "35px", letterSpacing: "-0.8px" };
const leadText: React.CSSProperties = { margin: "0 0 26px", color: colors.muted, fontSize: "16px", lineHeight: "25px" };
const primaryButton: React.CSSProperties = { display: "inline-block", padding: "14px 26px", borderRadius: "999px", backgroundColor: colors.forest, color: "#ffffff", fontSize: "15px", fontWeight: 700, textDecoration: "none" };
const afterButton: React.CSSProperties = { margin: "16px 0 0", color: colors.muted, fontSize: "13px", lineHeight: "20px" };
const insideBox: React.CSSProperties = { margin: "30px 0 0", padding: "20px 22px 6px", backgroundColor: colors.panel, borderRadius: "12px" };
const insideTitle: React.CSSProperties = { margin: "0 0 12px", color: colors.ink, fontSize: "14px", fontWeight: 700, lineHeight: "20px" };
const insideRow: React.CSSProperties = { margin: "0 0 14px", color: colors.muted, fontSize: "14px", lineHeight: "21px" };
const insideItem: React.CSSProperties = { color: colors.ink, fontWeight: 700 };
const finePrint: React.CSSProperties = { margin: "22px 0 0", color: colors.muted, fontSize: "12px", lineHeight: "18px" };
const footer: React.CSSProperties = { padding: "20px 28px 24px", backgroundColor: colors.surface, border: `1px solid ${colors.line}`, borderTop: `1px solid ${colors.line}`, borderRadius: "0 0 16px 16px" };
const footerText: React.CSSProperties = { margin: "0 0 6px", color: colors.muted, fontSize: "12px", lineHeight: "18px" };
const footerLink: React.CSSProperties = { color: colors.forest, fontWeight: 700, textDecoration: "none" };

export default SubscriptionEmail;
