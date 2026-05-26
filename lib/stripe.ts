import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  stripeClient = new Stripe(key, {
    // @ts-expect-error - Some TS versions might complain if the SDK is slightly older
    apiVersion: "2024-06-20",
    typescript: true,
  });

  return stripeClient;
}
