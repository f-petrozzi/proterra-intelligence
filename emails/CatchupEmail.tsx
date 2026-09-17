import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "react-email";
import type { Report } from "../src/lib/content";

export function readableDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function CatchupEmail({ reports, siteUrl, unsubscribeUrl }: { reports: Report[]; siteUrl: string; unsubscribeUrl: string }) {
  return <Html lang="en">
    <Head />
    <Preview>Three weeks of Proterra Intelligence, organized by reporting week.</Preview>
    <Body style={{ margin: 0, backgroundColor: "#f3f6f4", fontFamily: "Arial, Helvetica, sans-serif", color: "#15231f" }}>
      <Container style={{ maxWidth: "600px", width: "100%", backgroundColor: "white", margin: "0 auto" }}>
        <Section style={{ padding: "28px 24px" }}>
          <Text style={{ color: "#145f4a", fontSize: "12px", letterSpacing: "1px", fontWeight: 700 }}>PROTERRA INTELLIGENCE</Text>
          <Heading as="h1" style={{ fontSize: "30px", lineHeight: "36px" }}>Your three-week catch-up</Heading>
          <Text style={{ lineHeight: "24px" }}>{readableDate(reports[0].period.start)} – {readableDate(reports.at(-1)!.period.end)}</Text>
          <Text style={{ lineHeight: "24px", color: "#53605c" }}>Three reviewed weekly briefs in one email. Each section reflects its original reporting window; open the full issue for key points, context, and supporting sources.</Text>
        </Section>
        {reports.map(report => <Section key={report.slug} style={{ padding: "24px", borderTop: "1px solid #dce4e0" }}>
          <Text style={{ color: "#145f4a", fontSize: "12px", fontWeight: 700 }}>ISSUE {report.issueNumber} · {readableDate(report.publishedAt)}</Text>
          <Heading as="h2" style={{ fontSize: "22px", lineHeight: "29px", margin: "8px 0" }}>{readableDate(report.period.start)} – {readableDate(report.period.end)}</Heading>
          <Text style={{ fontWeight: 700, lineHeight: "24px" }}>{report.overview?.headline ?? report.title}</Text>
          <Text style={{ color: "#53605c", lineHeight: "23px", fontSize: "14px" }}>{report.executiveSummary}</Text>
          {report.items.map(item => <React.Fragment key={item.rank}>
            <Heading as="h3" style={{ fontSize: "16px", lineHeight: "23px", margin: "20px 0 6px" }}>
              <Link href={item.citations[0].url} style={{ color: "#173f32", textDecoration: "none" }}>{item.headline}</Link>
            </Heading>
            <Text style={{ fontSize: "13px", lineHeight: "21px", color: "#53605c", margin: "0 0 10px" }}>{item.summary}</Text>
          </React.Fragment>)}
          <Button href={`${siteUrl}/reports/${report.slug}/`} style={{ backgroundColor: "#145f4a", color: "white", borderRadius: "5px", padding: "12px 18px", fontSize: "13px", marginTop: "12px" }}>Read the {readableDate(report.publishedAt)} issue</Button>
        </Section>)}
        <Section style={{ padding: "24px", backgroundColor: "#edf1ef" }}>
          <Text style={{ fontSize: "11px", lineHeight: "18px", color: "#62706b" }}>Proterra Intelligence · Dairy, meat, and bovine genetics. Prepared from reviewed public sources. Reply with corrections or source suggestions.</Text>
          <Hr />
          <Text style={{ fontSize: "12px", lineHeight: "20px" }}><Link href={`${siteUrl}/archive/`}>Archive</Link>{" · "}<Link href={`${siteUrl}/#digest-signup-title`}>Share with others</Link>{" · "}<Link href={unsubscribeUrl}>Unsubscribe</Link></Text>
        </Section>
      </Container>
    </Body>
  </Html>;
}
