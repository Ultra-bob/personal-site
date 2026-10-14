declare module "hyphenation.en-us" {
  const patterns: Parameters<typeof import("tex-linebreak").createHyphenator>[0];

  export default patterns;
}
