import * as React from "react";
import { Body, Button, Column, Container, Head, Heading, Hr, Html, Img, Link, Preview, Row, Section, Text } from "react-email";
import type { Report } from "../src/lib/content";
import type { EditorialImage } from "../scripts/email/report";
import {
  absoluteUrl,
  body,
  boxTitle,
  colors,
  compactSummary,
  container,
  credit,
  ctaHeading,
  ctaSection,
  ctaText,
  ctaWrapper,
  dateLine,
  eyebrow,
  footer,
  footerLink,
  footerLinks,
  footerText,
  h1,
  h2,
  h3,
  headlineLink,
  bannerImage,
  bannerPath,
  issueUrl,
  keyPoint,
  keyPointBox,
  lead,
  masthead,
  primaryButton,
  pulseBasis,
  pulseColumn,
  pulseLabel,
  pulseSection,
  pulseValue,
  sectionLabel,
  sectorNames,
  sourceLine,
  sourceLink,
  storyDivider,
  storyMeta,
  storySummary,
  utilityLink,
  viewColumn,
  whyLabel,
  whyText
} from "./theme";

export function readableDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function storyLabel(item: Report["items"][number], rank?: number) {
  const sectors = item.sectors.map((sector) => sectorNames[sector]).join(" / ");
  return `${rank ? `${String(rank).padStart(2, "0")} · ` : ""}${sectors} · ${item.regions.join(" / ")}`;
}

export function CatchupEmail({ reports, siteUrl, images, unsubscribeUrl }: { reports: Report[]; siteUrl: string; images: Map<string, EditorialImage>; unsubscribeUrl: string }) {
  const first = reports[0];
  const last = reports.at(-1)!;
  const window = `${readableDate(first.period.start)} – ${readableDate(last.period.end)}`;

  return (
    <Html lang="en">
      <Head />
      <Preview>{`Issues ${first.issueNumber}–${last.issueNumber} in one email: every story from ${window}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={masthead}>
            <Row>
              <Column>
                <Text style={eyebrow}>PROTERRA INTELLIGENCE</Text>
                <Text style={dateLine}>{window} · Issues {first.issueNumber}–{last.issueNumber}</Text>
              </Column>
              <Column align="right" style={viewColumn}>
                <Link href={`${siteUrl}/archive/`} style={utilityLink}>View online</Link>
              </Column>
            </Row>
          </Section>

          {reports.map((report) => {
            const [topStory, ...otherStories] = report.items;
            const topImage = images.get(topStory.imageId);
            const onlineUrl = issueUrl(siteUrl, report.slug);

            return (
              <Section key={report.slug} style={weekSection}>
                {topImage && (
                  <>
                    <Link href={topStory.citations[0].url}>
                      <Img src={absoluteUrl(siteUrl, bannerPath(topImage.id))} width={552} height={230} alt={topImage.alt} style={bannerImage} />
                    </Link>
                    <Text style={bannerCredit}>Photo: {topImage.creator} · {topImage.license}</Text>
                  </>
                )}
                <Text style={sectionLabel}>ISSUE {report.issueNumber} · {readableDate(report.period.start)} – {readableDate(report.period.end)}</Text>
                <Heading as="h2" style={h2}>{report.overview?.headline ?? report.title}</Heading>
                <Text style={weekLead}>{report.executiveSummary}</Text>

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

                <Text style={storyMeta}>{storyLabel(topStory)}</Text>
                <Heading as="h3" style={h3}>
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
                <Text style={sourceLine}>
                  <Link href={topStory.citations[0].url} style={sourceLink}>{topStory.citations[0].title}</Link>
                </Text>

                {otherStories.map((item) => (
                  <React.Fragment key={item.rank}>
                    <Hr style={storyDivider} />
                    <Text style={storyMeta}>{storyLabel(item, item.rank)}</Text>
                    <Heading as="h3" style={compactHeadline}>
                      <Link href={item.citations[0].url} style={headlineLink}>{item.headline}</Link>
                    </Heading>
                    <Text style={compactSummary}>{item.summary}</Text>
                    <Text style={sourceLine}>
                      <Link href={item.citations[0].url} style={sourceLink}>{item.citations[0].title}</Link>
                    </Text>
                  </React.Fragment>
                ))}

                <Section style={issueButtonWrapper}>
                  <Button href={onlineUrl} style={primaryButton}>Open issue {report.issueNumber}</Button>
                </Section>
              </Section>
            );
          })}

          <Section style={ctaWrapper}>
            <Section style={ctaSection}>
              <Heading as="h2" style={ctaHeading}>Back to the weekly rhythm</Heading>
              <Text style={ctaText}>The next issue arrives on its usual schedule. The archive holds every brief, with sources and the current dashboard.</Text>
              <Button href={`${siteUrl}/archive/`} style={primaryButton}>Open the archive</Button>
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
              {" · "}
              <Link href={`${siteUrl}/subscriptions?intent=invite`} style={footerLink}>Invite someone</Link>
              {" · "}
              <Link href={unsubscribeUrl} style={footerLink}>Unsubscribe</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const bannerCredit: React.CSSProperties = { ...credit, margin: "8px 0 18px" };
const weekSection: React.CSSProperties = { padding: "30px 24px 34px", borderTop: `1px solid ${colors.line}` };
const weekLead: React.CSSProperties = { margin: "0 0 22px", color: "#43514c", fontSize: "15px", lineHeight: "24px" };
const pulseWrapper: React.CSSProperties = { padding: "0 0 26px" };
const compactHeadline: React.CSSProperties = { margin: "0 0 8px", fontSize: "17px", lineHeight: "24px", letterSpacing: "-0.15px" };
const issueButtonWrapper: React.CSSProperties = { padding: "26px 0 0" };

export default CatchupEmail;
