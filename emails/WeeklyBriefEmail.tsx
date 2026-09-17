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
  unsubscribeUrl?: string;
};

import {
  absoluteUrl,
  colors,
  formatDate,
  issueUrl,
  sectorNames,
  body,
  boxTitle,
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
  heroImage,
  heroSize,
  intro,
  keyPoint,
  keyPointBox,
  latestSection,
  lead,
  masthead,
  primaryButton,
  pulseBasis,
  pulseColumn,
  pulseLabel,
  pulseSection,
  pulseValue,
  pulseWrapper,
  sectionLabel,
  sourceLine,
  sourceLink,
  storyDivider,
  storyMeta,
  storySummary,
  topStorySection,
  utilityLink,
  viewColumn,
  whyLabel,
  whyText
} from "./theme";

export function WeeklyBriefEmail({ report, siteUrl, images, unsubscribeUrl }: WeeklyBriefEmailProps) {
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
              <>
                <Link href={topStory.citations[0].url}>
                  <Img
                    src={absoluteUrl(siteUrl, topImage.src)}
                    {...heroSize(topImage)}
                    alt={topImage.alt}
                    style={heroImage}
                  />
                </Link>
                <Text style={{ ...credit, textAlign: heroSize(topImage).width < 552 ? "center" : "left" }}>Photo: {topImage.creator} · {topImage.license}</Text>
              </>
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
              {" · "}
              <Link href={`${siteUrl}/subscriptions?intent=invite`} style={footerLink}>Invite someone</Link>
              {" · "}
              <Link href={unsubscribeUrl ?? `${siteUrl}/subscriptions?intent=unsubscribe`} style={footerLink}>Unsubscribe</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default WeeklyBriefEmail;
