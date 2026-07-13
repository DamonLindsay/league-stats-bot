import { getFirestore } from "firebase-admin/firestore"

export interface Friend {
    discordName: string;
    gameName: string;
    tagLine: string;
    platform: string;
    regionalCluster: string;
    matchRegionalCluster: string;
}

/**
 * Fetches all tracked friends from the Firestore "friends" collection.
 */
export async function getFriends(): Promise<Friend[]> {
    const db = getFirestore();
    const snapshot = await db.collection("friends").get();

    return snapshot.docs.map((doc) => doc.data() as Friend)
}