# Privacy Policy for Tab Organizer

Last updated: 2026-11-26

## Summary

Tab Organizer organizes your Chrome tabs into native tab groups on your device. It does **not** send your browsing data to our servers. We do not operate a remote backend for this extension.

## What Data We Collect

The extension reads and may store the following **on your device only** (via Chrome local storage):

- **Tab URLs and titles** while filing tabs into groups (read in memory to decide grouping). Full tab URLs are **not** written to the activity history.
- **Your settings**: whether auto-file is on, whether the optional local model is on, which model name you selected, grouping rules, Protect lists, quiet hours, layouts, and related preferences.
- **Activity log entries**: a short local history (capped) of organize / rename / rule / clean-up actions, using **site keys / domains** and group titles — never a durable `tabUrl` field. Older installs that stored a full URL are stripped on read.
- **Short-lived clean-up undo**: after Clean up closes tabs, full http(s) URLs may be kept in `chrome.storage.session` for about 10 minutes so you can undo, then cleared.
- **UI preferences** such as light/dark theme.

Diagnostic summaries shown in the UI use hostname/counts only; production responses do not include full-URL samples.

The extension does **not** read page cookies, passwords, form contents, or the full page DOM. Extension messages are accepted only from this extension’s own pages (not from other extensions).

## Optional local model (Ollama)

If you turn on **Local model**, the extension may send a small **feature card** to a model running on **your machine** at `127.0.0.1:11434` / `localhost:11434` (Ollama). That card includes:

- Registrable domain
- A stripped tab title
- Path words (long tokens / secrets filtered out)

Nothing in that path is sent to Tab Organizer’s servers, because there are none. You control whether Ollama runs and which model you use. If Local model is off, no such requests are made.

## How Data Is Stored

All settings and activity history use **Chrome local storage on your device**. The extension does not use sync storage that copies data to Google’s servers for this product’s settings.

## How Data Is Used

Data is used only to:

- File tabs into Chrome tab groups according to site, title, and your rules
- Optionally ask your local Ollama model when a rule or tab is unclear
- Show you a local activity history and let you manage groups in the dashboard

## Third-Party Services

Tab Organizer does **not** use analytics, advertising, crash-reporting, or other remote third-party services.

Optional: **Ollama** (local only), if you install and enable it yourself. See [https://ollama.com](https://ollama.com) for that product’s own documentation.

## Data Sharing

We do not sell, rent, or share your data with third parties. We have no remote server that receives your tab data.

## Data Retention and Deletion

- Settings and activity history remain on your device until you clear them or uninstall the extension.
- You can clear the activity log from the extension dashboard.
- Uninstalling the extension removes its local storage.

## Changes to This Policy

If data practices change, we will update this policy and the “Last updated” date. Material changes will also be reflected in the Chrome Web Store privacy disclosures.

## Contact

Privacy questions: jenil.desai25@gmail.com

Project: https://github.com/jenildesai25/tab-organizer
