# @tginfo Ghost Theme

> [!WARNING] 
> This is a fork of the https://github.com/SourceTheme-i18n/Source theme
> which is itself a fork of the official Ghost Source theme to add translations.
> The original theme is set as upstream, only translations needed by @tginfo org
> will be maintained by the @tginfo members.

Over time, this theme might diverge from the original Source theme significantly
to better suit the needs of the @tginfo org.

# Structure

Ghost uses a simple templating language called [Handlebars](http://handlebarsjs.com/) for its themes.

This theme has lots of code comments to help explain what's going on just by reading the code. 
Once you feel comfortable with how everything works, Ghost also has 
full [theme API documentation](https://ghost.org/docs/themes/) which explains every possible 
Handlebars helper and template.

**The main files are:**

-   `default.hbs` - The parent template file, which includes your global header/footer
-   `home.hbs` - The homepage
-   `index.hbs` - The main template to generate a list of posts
-   `post.hbs` - The template used to render individual posts
-   `page.hbs` - Used for individual pages
-   `tag.hbs` - Used for tag archives, eg. "all posts tagged with `news`"
-   `author.hbs` - Used for author archives, eg. "all posts written by Jamie"

One neat trick is that you can also create custom one-off templates by adding the slug of a 
page to a template file. For example:

-   `page-about.hbs` - Custom template for an `/about/` page
-   `tag-news.hbs` - Custom template for `/tag/news/` archive
-   `author-ali.hbs` - Custom template for `/author/ali/` archive

# Development

Source styles are compiled using Gulp/PostCSS to polyfill future CSS spec. You'll need [Node](https://nodejs.org/) and [pnpm](https://pnpm.io/). After that, from the theme's root directory:

```bash
# install dependencies
pnpm install

# run development server
pnpm dev
```

Now you can edit `/assets/css/` files, which will be compiled to `/assets/built/` automatically.

The `zip` Gulp task packages the theme files into `dist/<theme-name>.zip`, which 
you can then upload to your site.

```bash
# create .zip file
pnpm zip
```

# Publishing a release

Releases are shipped from an up-to-date, clean `main` branch in two steps. Before starting, configure `GST_TOKEN` with a GitHub token that can create releases in `TryGhost/Source`.

First bump the version. This updates `package.json`, then creates a commit and annotated `v<version>` git tag:

```bash
# pick one of: patch | minor | major (or an explicit version, e.g. 1.8.0)
pnpm version minor
```

Then run `ship`:

```bash
pnpm ship
```

`pnpm ship`:

1. Builds the theme zip and runs GScan.
2. Refuses to continue if the working tree is not clean after the build.
3. Pushes the version commit and tag.
4. Prompts for the minimum compatible Ghost version and creates a draft GitHub release with the generated changelog.

Review and publish the draft GitHub release after the command completes. The pushed theme tag, rather than the GitHub release, is what the next Ghost release uses when updating its bundled Source theme.

> [!NOTE]
> `pnpm version` requires an explicit version or bump type. Run it before `pnpm ship`; the ship command does not perform the bump itself.

# PostCSS Features Used

-   Autoprefixer - Don't worry about writing browser prefixes of any kind, 
it's all done automatically with support for the latest 2 major versions of every browser.

# SVG Icons

Source uses inline SVG icons, included via Handlebars partials. 
You can find all icons inside `/partials/icons`. To use an icon just include the name 
of the relevant file, eg. To include the SVG icon 
in `/partials/icons/rss.hbs` - use `{{> "icons/rss"}}`.

You can add your own SVG icons in the same manner.
# Translations

Please see [@TryGhost/Themes/theme-translations/README.md](https://github.com/TryGhost/Themes/blob/main/packages/theme-translations/README.md) for how to build, edit, or contribute translations.

# Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - 
Released under the [MIT license](https://github.com/TryGhost/Source/blob/fb58907579dfc2c73f4e8d74da43857b163351fe/LICENSE).

Copyright (c) 2023-2025 [Source i18n contributors](https://github.com/SourceTheme-i18n/Source/graphs/contributors) - 
Released under the [MIT license](https://github.com/SourceTheme-i18n/Source/blob/89c6c67354e266ffba0aef3bd6a322590e80e3e5/LICENSE).
