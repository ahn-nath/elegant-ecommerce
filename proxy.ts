import { withAuth } from "@kinde-oss/kinde-auth-nextjs/middleware";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export default withAuth(
  async function proxy(req: NextRequest) {
    const { getPermission } = getKindeServerSession();
    const permission = await getPermission("is-admin");

    // 1. Logic for the /dashboard middle-ground
    if (req.nextUrl.pathname === "/dashboard") {
      // Redirect at the server level - no flashes!
      if (permission?.isGranted) {
        return NextResponse.redirect(new URL("/admin", req.url));
      } else {
        return NextResponse.redirect(new URL("/user-dashboard", req.url));
      }
    }

    // 2. Protect /admin routes from non-admins
    if (req.nextUrl.pathname.startsWith("/admin")) {
      if (!permission?.isGranted) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    isReturnToCurrentPage: true,
    publicPaths: [
      "/",
      "/contact",
      "/blog",
      "/about",
      "/shop",
      "/api",
      "/api/auth/setup",
      "/api/auth/kinde_callback",
      "/api/auth/login",
      "/api/auth/register",
      "/api/blog-categories",
      "/api/categories",
      "/api/auth",
      "/api/products",
      "/api/blogs",
      "/api/blogs/*",
      "/api/wishlist",
      "/api/newsletter",
    ],
  },
);
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
