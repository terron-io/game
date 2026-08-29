const GITHUB_MENTION_REGEX =
  /(^|[^\w/[`])@([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)(?![\w-])/gim;

export function normalizeNewsMarkdown(markdown: string): string {
  return (
    markdown
      // Convert bold header lines (e.g. "**Title**") into real Markdown headers.
      // Exclude lines starting with - or * to avoid converting bullet points.
      .replace(/^([^\-*\s].*?) \*\*(.+?)\*\*$/gm, "## $1 $2")
      // terron: автоссылки на чужой github (PR/compare) убраны.
      .replace(
        GITHUB_MENTION_REGEX,
        (_match, prefix, username) =>
          `${prefix}[@${username}](https://github.com/${username})`,
      )
  );
}
