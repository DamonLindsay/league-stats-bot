import axios from "axios";

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