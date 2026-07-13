import axios from "axios";
import FormData from "form-data"

/**
 * Posts a message to a Discord channel via webhook, appearing as "Orianna"
 */
export async function postToDiscord(
    webhookUrl: string,
    message: string
): Promise<void> {
    await axios.post(webhookUrl, {
        username: "Orianna",
        content: message,
    });
}

/**
 * Posts a PNG image to a Discord channel via webhook, appearing as "Orianna".
 */
export async function postImageToDiscord(
    webhookUrl: string,
    imageBuffer: Buffer,
    filename: string
): Promise<void> {
    const form = new FormData();

    form.append(
        "payload_json",
        JSON.stringify({ username: "Orianna"})
    );

    form.append("file", imageBuffer, {
        filename,
        contentType: "image/png",
    });

    await axios.post(webhookUrl, form, {
        headers: form.getHeaders(),
    });
}