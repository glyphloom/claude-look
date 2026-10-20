Claude Look draws a session's tool calls, images, video and audio the way Claude Desktop draws them.

The steps between two replies (tool calls, thinking, todo updates and images a tool returned) fold into one quiet summary line, such as "Read 3 files, ran 2 commands". Opening it lists the steps, each a muted verb and its target, and each step opens a card with its input and output. Edits show their diff with added and removed line counts. A short run with a failed call opens by itself.

Images a tool returned, such as a screenshot or a picture Claude read, appear inline at a modest height and open in a dark lightbox. A link to a video or audio file in a reply gets a player under it. Images you attach to a message are shown as tiles.

## Data access

To show images, video and audio, the plugin's daemon side reads those files from the daemon machine and sends them to your Paseo client. It reads only files with an image, video or audio extension, up to 40 MB each, and only when the timeline points at them. Nothing is sent anywhere else.

## Limits

- Requires Paseo 0.11.2 or later.
- The spacing between rows, the media players and the attachment tiles work by adjusting Paseo's page, so they appear only in the web and desktop apps, and a Paseo update can break them until the plugin is updated. The tool rows and tool images work on phones too.
- Replacing Paseo's tool rows replaces its own grouping of them, and Paseo's plan, approval and speech rows are left as they are.
- Two sessions streaming at the same time can split or merge each other's summary lines until the session is reopened.
