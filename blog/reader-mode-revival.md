---
title: Could AI revive Reader Mode?
description: Side effects of designing for agents
pubDate: 2026-10-10
---

Recently, there's been a lot of discussion about optimizing sites so AI agents can easily read and access their content ([is-agentic.com](https://is-agentic.com/)). Since markdown is the language of agents now, one big way to do that is serving plain Markdown files instead of HTML on request ([acceptmarkdown.com](https://acceptmarkdown.com/)). Agents (or humans...) can set the HTTP header `Accept: text/markdown`, and supported sites will return a markdown verison of the page.

For example, on [Mintlify](https://www.mintlify.com/)'s [quickstart page](https://www.mintlify.com/docs/quickstart), setting `Accept: text/markdown` yields a clean markdown version of the page content:

```md
> ## Documentation Index
>
> Fetch the complete documentation index at: https://www.mintlify.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart

> Get started with Mintlify by deploying your documentation site in minutes and making your first content change with the web editor or Git.

After you complete this guide, you'll have a live documentation site ready to customize and update.

## Set up Mintlify for the user

[...]
```

But, what this really means is that you can set this one HTTP header, and some sites will hand you a their page content, without any ads, tracking or extra content. What more could you ask for when using reader mode?

[acceptmarkdown.com](https://acceptmarkdown.com) literally spells it out on their hero page:

> **Higher signal-to-noise.**
>
> No ads, related-content rails, or modal overlays muddying the text a RAG pipeline has to embed.

Replace "RAG pipeline" with "human eyeball", and you can see why it's so attractive. Just make a browser extension that sets the appropriate header, and then renders markdown instead of HTML if possible, and you could see a lot of articles (especially technical ones) rendered with fonts, text sizes and colors rendered to your preference, without huge HTML/JS payloads. I could even see a whole markdown based browser being possible if adoption increases.

Of course, because the markdown spec is so loose, there will be some formatting quirks. The mintlify example from earlier has some weird HTML style markup:

```md
Your documentation site is now deployed at `https://<your-project-name>.mintlify.site`.

Find your exact URL on the **Overview** page of your [dashboard](https://app.mintlify.com/).

<Frame>
  <img alt="Overview page of the Mintlify dashboard." className="block dark:hidden" src="https://mintcdn.com/mintlify/f7fo9pnTEtzBD70_/images/quickstart/mintlify-domain-light.png?fit=max&auto=format&n=f7fo9pnTEtzBD70_&q=85&s=282a86eda5f3ab5d9723b62a330ea2af" width="3024" height="1372" data-path="images/quickstart/mintlify-domain-light.png" />

  <img alt="Overview page of the Mintlify dashboard." className="hidden dark:block" src="https://mintcdn.com/mintlify/f7fo9pnTEtzBD70_/images/quickstart/mintlify-domain-dark.png?fit=max&auto=format&n=f7fo9pnTEtzBD70_&q=85&s=cd2c945d8bb3c8deb4c655816e72d134" width="3008" height="1368" data-path="images/quickstart/mintlify-domain-dark.png" />
</Frame>
```

It's still a lot better than the raw HTML, and hopefully over time things will become more standardized, or maybe HTML rendering escape hatches will be implemented.

---

Overall, this feels like part of a bigger trend i've noticed that open formats (markdown, HTML) have been much more agent-ready than closed ecosystems (Notion). As a result of this, companies that used to hold your data hostage have scrambled to open it up, not for humans, but agents via MCP servers and the like. However, I think this openness benefits everyone, although it's ironic that AI made open data a priority.

_side note: this idea about reader mode seems pretty original, the only other discussion i've found is [this tweet](https://x.com/rajadain/status/2022070909071475098)_
