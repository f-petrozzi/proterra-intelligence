import * as React from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text
} from "react-email";
import type { Report } from "../src/lib/content";
import type { EditorialImage } from "../scripts/email/report";

type WeeklyBriefEmailProps = {
  report: Report;
  siteUrl: string;
  images: Map<string, EditorialImage>;
};

const colors = {
  ink: "#15231f",
  muted: "#62706b",
  line: "#dce4e0",
  paper: "#ffffff",
  canvas: "#f3f6f4",
  green: "#145f4a",
  greenSoft: "#e8f1ed",
  warm: "#f6f1e8"
};

const sectorNames: Record<string, string> = {
  dairy: "Dairy",
  meat: "Meat",
  "bovine-genetics": "Bovine genetics"
};

function absoluteUrl(siteUrl: string, path: string) {
  return path.startsWith("http") ? path : `${siteUrl}${path}`;
}

function issueUrl(siteUrl: string, slug: string) {
  return `${siteUrl}/reports/${slug}/`;
}

export function WeeklyBriefEmail({ report, siteUrl, images }: WeeklyBriefEmailProps) {
  const [topStory, ...otherStories] = report.items;
  const topImage = images.get(topStory.imageId);
  const onlineUrl = issueUrl(siteUrl, report.slug);
  const previewText = report.overview?.headline ?? report.executiveSummary;

  return (
    <Html lang="en">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={masthead}>
            <Row>
              <Column>
                <Text style={eyebrow}>PROTERRA INTELLIGENCE</Text>
                <Text style={dateLine}>{formatDate(report.publishedAt)} · Issue {report.issueNumber}</Text>
              </Column>
              <Column align="right" style={viewColumn}>
                <Link href={onlineUrl} style={utilityLink}>View online</Link>
              </Column>
            </Row>
          </Section>

          <Section style={intro}>
            <Heading as="h1" style={h1}>{report.overview?.headline ?? "This week in livestock and genetics"}</Heading>
            <Text style={lead}>{report.executiveSummary}</Text>
          </Section>

          {report.dashboard?.sectorPulses && (
            <Section style={pulseWrapper}>
              <Section style={pulseSection}>
                <Row>
                  {report.dashboard.sectorPulses.map((pulse) => (
                    <Column key={pulse.sector} style={pulseColumn}>
                      <Text style={pulseLabel}>{sectorNames[pulse.sector]}</Text>
                      <Text style={pulseValue}>{pulse.value}</Text>
                      <Text style={pulseBasis}>{pulse.basis}</Text>
                    </Column>
                  ))}
                </Row>
              </Section>
            </Section>
          )}

          <Section style={topStorySection}>
            <Text style={sectionLabel}>TOP STORY</Text>
            {topImage && (
              <Link href={topStory.citations[0].url}>
                <Img
                  src={absoluteUrl(siteUrl, topImage.src)}
                  width="552"
                  alt={topImage.alt}
                  style={heroImage}
                />
              </Link>
            )}
            {topImage && (
              <Text style={credit}>Photo: {topImage.creator} · {topImage.license}</Text>
            )}
            <Text style={storyMeta}>
              {topStory.sectors.map((sector) => sectorNames[sector]).join(" · ")} · {topStory.regions.join(" · ")}
            </Text>
            <Heading as="h2" style={h2}>
              <Link href={topStory.citations[0].url} style={headlineLink}>{topStory.headline}</Link>
            </Heading>
            <Text style={storySummary}>{topStory.summary}</Text>
            <Section style={keyPointBox}>
              <Text style={boxTitle}>Key points</Text>
              {topStory.keyPoints.slice(0, 3).map((point) => (
                <Text key={point} style={keyPoint}>• {point}</Text>
              ))}
            </Section>
            <Text style={whyLabel}>WHY IT MATTERS TO PROTERRA</Text>
            <Text style={whyText}>{topStory.whyItMatters}</Text>
            <Button href={topStory.citations[0].url} style={primaryButton}>Read the source</Button>
          </Section>

          <Section style={latestSection}>
            <Text style={sectionLabel}>MORE THIS WEEK</Text>
            {otherStories.map((item, index) => {
              const primary = item.citations[0];
              return (
                <React.Fragment key={item.rank}>
                  {index > 0 && <Hr style={storyDivider} />}
                  <Text style={storyMeta}>
                    {String(item.rank).padStart(2, "0")} · {item.sectors.map((sector) => sectorNames[sector]).join(" / ")} · {item.regions.join(" / ")}
                  </Text>
                  <Heading as="h3" style={h3}>
                    <Link href={primary.url} style={headlineLink}>{item.headline}</Link>
                  </Heading>
                  <Text style={compactSummary}>{item.summary}</Text>
                  <Text style={sourceLine}>
                    <Link href={primary.url} style={sourceLink}>{primary.title} →</Link>
                  </Text>
                </React.Fragment>
              );
            })}
          </Section>

          <Section style={ctaWrapper}>
            <Section style={ctaSection}>
              <Heading as="h2" style={ctaHeading}>Continue with the full brief</Heading>
              <Text style={ctaText}>Review every source, expand the key points, and open the current dashboard on Proterra Intelligence.</Text>
              <Button href={onlineUrl} style={primaryButton}>Open the weekly brief</Button>
            </Section>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>Proterra Intelligence · Dairy, meat, and bovine genetics</Text>
            <Text style={footerText}>Prepared from reviewed public sources. Reply to this email with corrections or source suggestions.</Text>
            <Text style={footerLinks}>
              <Link href={`${siteUrl}/sources/`} style={footerLink}>Sources</Link>
              {" · "}
              <Link href={`${siteUrl}/methodology/`} style={footerLink}>Methodology</Link>
              {" · "}
              <Link href={`${siteUrl}/archive/`} style={footerLink}>Archive</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

const body: React.CSSProperties = { margin: 0, backgroundColor: colors.canvas, color: colors.ink, fontFamily: "Arial, Helvetica, sans-serif" };
const container: React.CSSProperties = { width: "100%", maxWidth: "600px", margin: "0 auto", backgroundColor: colors.paper };
const masthead: React.CSSProperties = { padding: "24px", borderBottom: `1px solid ${colors.line}` };
const eyebrow: React.CSSProperties = { margin: "0 0 4px", color: colors.green, fontSize: "12px", fontWeight: 700, letterSpacing: "1.4px" };
const dateLine: React.CSSProperties = { margin: 0, color: colors.muted, fontSize: "12px", lineHeight: "18px" };
const viewColumn: React.CSSProperties = { width: "105px" };
const utilityLink: React.CSSProperties = { color: colors.green, fontSize: "12px", textDecoration: "underline" };
const intro: React.CSSProperties = { padding: "34px 24px 26px" };
const h1: React.CSSProperties = { margin: "0 0 14px", color: colors.ink, fontSize: "32px", lineHeight: "38px", letterSpacing: "-0.6px" };
const lead: React.CSSProperties = { margin: 0, color: "#43514c", fontSize: "16px", lineHeight: "25px" };
const pulseWrapper: React.CSSProperties = { padding: "0 24px 32px" };
const pulseSection: React.CSSProperties = { width: "100%", backgroundColor: colors.greenSoft, borderRadius: "8px" };
const pulseColumn: React.CSSProperties = { width: "33.333%", padding: "16px 10px", textAlign: "center", verticalAlign: "top" };
const pulseLabel: React.CSSProperties = { margin: "0 0 6px", color: colors.muted, fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" };
const pulseValue: React.CSSProperties = { margin: "0 0 3px", color: colors.ink, fontSize: "22px", fontWeight: 700, lineHeight: "26px" };
const pulseBasis: React.CSSProperties = { margin: 0, color: colors.muted, fontSize: "10px", lineHeight: "14px" };
const topStorySection: React.CSSProperties = { padding: "0 24px 36px" };
const sectionLabel: React.CSSProperties = { margin: "0 0 14px", color: colors.green, fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px" };
const heroImage: React.CSSProperties = { display: "block", width: "100%", height: "auto", borderRadius: "8px" };
const credit: React.CSSProperties = { margin: "6px 0 18px", color: "#78847f", fontSize: "10px", lineHeight: "14px" };
const storyMeta: React.CSSProperties = { margin: "0 0 7px", color: colors.green, fontSize: "11px", fontWeight: 700, lineHeight: "16px", textTransform: "uppercase" };
const h2: React.CSSProperties = { margin: "0 0 12px", fontSize: "25px", lineHeight: "31px", letterSpacing: "-0.35px" };
const h3: React.CSSProperties = { margin: "0 0 8px", fontSize: "20px", lineHeight: "26px", letterSpacing: "-0.2px" };
const headlineLink: React.CSSProperties = { color: colors.ink, textDecoration: "none" };
const storySummary: React.CSSProperties = { margin: "0 0 18px", color: "#43514c", fontSize: "15px", lineHeight: "24px" };
const keyPointBox: React.CSSProperties = { margin: "0 0 18px", padding: "16px 18px", backgroundColor: colors.warm, borderRadius: "8px" };
const boxTitle: React.CSSProperties = { margin: "0 0 9px", color: colors.ink, fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px" };
const keyPoint: React.CSSProperties = { margin: "6px 0", color: "#43514c", fontSize: "14px", lineHeight: "21px" };
const whyLabel: React.CSSProperties = { margin: "0 0 5px", color: colors.muted, fontSize: "10px", fontWeight: 700, letterSpacing: "0.8px" };
const whyText: React.CSSProperties = { margin: "0 0 18px", color: "#43514c", fontSize: "14px", lineHeight: "22px" };
const primaryButton: React.CSSProperties = { backgroundColor: colors.green, borderRadius: "6px", color: "#ffffff", display: "inline-block", fontSize: "13px", fontWeight: 700, padding: "12px 18px", textDecoration: "none" };
const latestSection: React.CSSProperties = { padding: "30px 24px 36px", borderTop: `1px solid ${colors.line}` };
const storyDivider: React.CSSProperties = { margin: "24px 0", borderColor: colors.line, borderWidth: "1px 0 0" };
const compactSummary: React.CSSProperties = { margin: "0 0 8px", color: "#53605c", fontSize: "14px", lineHeight: "22px" };
const sourceLine: React.CSSProperties = { margin: 0, fontSize: "12px", lineHeight: "18px" };
const sourceLink: React.CSSProperties = { color: colors.green, fontWeight: 700, textDecoration: "none" };
const ctaWrapper: React.CSSProperties = { padding: "0 24px 28px" };
const ctaSection: React.CSSProperties = { width: "100%", padding: "25px", backgroundColor: colors.greenSoft, borderRadius: "8px", textAlign: "center" };
const ctaHeading: React.CSSProperties = { margin: "0 0 8px", color: colors.ink, fontSize: "21px", lineHeight: "27px" };
const ctaText: React.CSSProperties = { margin: "0 auto 18px", color: "#53605c", fontSize: "14px", lineHeight: "21px" };
const footer: React.CSSProperties = { padding: "24px", backgroundColor: "#edf1ef", borderTop: `1px solid ${colors.line}` };
const footerText: React.CSSProperties = { margin: "0 0 7px", color: colors.muted, fontSize: "11px", lineHeight: "17px" };
const footerLinks: React.CSSProperties = { margin: "13px 0 0", color: colors.muted, fontSize: "11px" };
const footerLink: React.CSSProperties = { color: colors.green, textDecoration: "underline" };

export default WeeklyBriefEmail;
