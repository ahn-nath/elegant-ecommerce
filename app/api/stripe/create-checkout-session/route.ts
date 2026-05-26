import { NextRequest, NextResponse } from "next/server";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { getStripe } from "@/lib/stripe";
import connectDB from "@/lib/db";
import { Cart } from "@/models/Cart";
import { User } from "@/models/User";
import { Order } from "@/models/Order";

export async function POST(request: NextRequest) {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Stripe not configured" },
        { status: 503 },
      );
    }

    await connectDB();
    const { getUser } = getKindeServerSession();
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await User.findOne({ kindeUserId: user.id });
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if user is admin (admins cannot place orders)
    if (dbUser.role === "admin") {
      return NextResponse.json(
        { error: "Admins cannot place orders" },
        { status: 403 },
      );
    }

    const { shippingAddress } = await request.json();

    if (
      !shippingAddress ||
      !shippingAddress.country ||
      !shippingAddress.state ||
      !shippingAddress.city ||
      !shippingAddress.street ||
      !shippingAddress.zipCode
    ) {
      return NextResponse.json(
        { error: "Complete shipping address is required" },
        { status: 400 },
      );
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId: dbUser._id }).populate(
      "items.productId",
      "name price images",
    );

    if (!cart || !cart.items.length) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Calculate total
    const totalAmount = cart.items.reduce(
      (sum: number, item: any) =>
        sum + (item.productId?.price || 0) * item.quantity,
      0,
    );

    // Create order in database with pending status
    const order = await Order.create({
      userId: dbUser._id,
      items: cart.items.map((item: any) => ({
        productId: item.productId._id,
        name: item.productId.name,
        price: item.productId.price,
        quantity: item.quantity,
      })),
      totalAmount,
      shippingAddress,
      status: "pending",
      paymentId: "pending", // Temporary placeholder
    });

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: cart.items.map((item: any) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.productId.name,
            images: item.productId.images,
          },
          unit_amount: Math.round(item.productId.price * 100), // Convert to cents
        },
        quantity: item.quantity,
      })),
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order._id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout/cancel`,
      metadata: {
        orderId: order._id.toString(),
        userId: dbUser._id.toString(),
      },
      customer_email: user.email || undefined,
    });

    // Update order with Stripe session ID
    await Order.findByIdAndUpdate(order._id, {
      paymentId: session.id,
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }
}
