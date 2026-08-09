const markdownIt = require("markdown-it");

module.exports = function (eleventyConfig) {
  // Allow the raw <br> line breaks used in the migrated poem-style posts.
  eleventyConfig.setLibrary(
    "md",
    markdownIt({ html: true, breaks: false, linkify: true })
  );

  // Static assets copied as-is into the build output.
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  // Posts collection: newest first, drafts excluded from the build.
  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi
      .getFilteredByGlob("src/posts/*.md")
      .filter((post) => !post.data.draft)
      .sort((a, b) => b.data.date - a.data.date);
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
