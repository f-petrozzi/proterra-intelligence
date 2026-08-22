export type ImagePolicyStory = {
  rank: number;
  headline: string;
  imageId: string;
};

export type ImagePolicyAsset = {
  subjects: string[];
};

function words(value: string) {
  return new Set((value.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((word) => {
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }));
}

export function assertEditorialImageAssignments(
  stories: ImagePolicyStory[],
  images: ReadonlyMap<string, ImagePolicyAsset>,
  path: string
) {
  const imageIds = stories.map((story) => story.imageId);
  if (new Set(imageIds).size !== imageIds.length) {
    throw new Error(`${path}: automated reports must use a different editorial image for every story.`);
  }

  for (const story of stories) {
    const image = images.get(story.imageId);
    if (!image) continue;
    const headlineWords = words(story.headline);
    const subjectWords = image.subjects.flatMap((subject) => [...words(subject)]);
    if (!subjectWords.some((word) => headlineWords.has(word))) {
      throw new Error(
        `${path}: item ${story.rank} image "${story.imageId}" does not match a declared subject in its headline.`
      );
    }
  }
}
