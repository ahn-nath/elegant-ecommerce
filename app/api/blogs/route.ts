import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { Blog } from "@/models/Blog";
import { BlogCategory } from "@/models/BlogCategory";
import { validateAdmin } from "@/lib/admin-guard";
import cloudinary from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";

// Helper function to generate slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w ]+/g, "")
    .replace(/ +/g, "-");
}

export async function POST(req: NextRequest) {
  try {
    // Check admin permission
    const isAdmin = await validateAdmin();
    if (!isAdmin) {
      return NextResponse.json(
        { message: "Unauthorized: Admin access required" },
        { status: 403 },
      );
    }

    await connectDB();

    // Parse FormData directly (App Router compatible)
    const formData = await req.formData();

    // Extract form fields
    const title = String(formData.get("title") || "").trim();
    const content = String(formData.get("content") || "").trim();
    const author = String(formData.get("author") || "Admin").trim();
    const category = String(formData.get("category") || "").trim();

    // Get thumbnail file
    let thumbnailFile: File | null = null;
    for (const [key, value] of formData.entries()) {
      if (key === "thumbnail" && value instanceof File) {
        thumbnailFile = value;
        break;
      }
    }

    console.log("Blog form data received:", {
      title,
      contentLength: content.length,
      author,
      category,
      hasThumbnail: !!thumbnailFile,
    });

    // Validate required fields
    if (!title) {
      return NextResponse.json(
        { error: "Blog title is required" },
        { status: 400 },
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: "Blog content is required" },
        { status: 400 },
      );
    }

    if (!thumbnailFile) {
      return NextResponse.json(
        { error: "Blog thumbnail image is required" },
        { status: 400 },
      );
    }

    // Generate slug from title
    const slug = generateSlug(title);

    // Check if blog with same slug already exists
    const existingBlog = await Blog.findOne({ slug });
    if (existingBlog) {
      return NextResponse.json(
        { error: "Blog with this title already exists" },
        { status: 409 },
      );
    }

    // Verify category exists if provided
    let categoryId = null;
    if (category) {
      const categoryExists = await BlogCategory.findById(category);
      if (!categoryExists) {
        return NextResponse.json(
          { error: "Blog category not found" },
          { status: 404 },
        );
      }
      categoryId = category;
    }

    // Upload thumbnail to Cloudinary
    let thumbnailUrl = "";
    try {
      // Convert file to base64
      const arrayBuffer = await thumbnailFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
      const dataUri = `data:${thumbnailFile.type};base64,${base64}`;

      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(dataUri, {
        folder: "ElegantEcommerce/blogs",
        transformation: [{ width: 800, height: 450, crop: "limit" }],
      });

      thumbnailUrl = result.secure_url;
      console.log(`Uploaded thumbnail: ${thumbnailUrl}`);
    } catch (error) {
      console.error("Error uploading thumbnail to Cloudinary:", error);
      return NextResponse.json(
        { error: "Failed to upload thumbnail image" },
        { status: 500 },
      );
    }

    // Create new blog
    const newBlog = new Blog({
      title,
      slug,
      content,
      author,
      category: categoryId,
      thumbnail: thumbnailUrl,
    });

    await newBlog.save();

    // Populate category details in response
    const populatedBlog = await Blog.findById(newBlog._id).populate(
      "category",
      "name slug",
    );

    // Revalidate the admin blogs page
    revalidatePath("/admin/blogs");

    return NextResponse.json(
      {
        success: true,
        message: "Blog created successfully",
        blog: populatedBlog,
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("Error creating blog:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create blog",
      },
      { status: 500 },
    );
  }
}

// GET all blogs with category details
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") || "";
    const category = searchParams.get("category") || "";
    const sort = searchParams.get("sort") || "-createdAt";
    const limit = searchParams.get("limit") || "";
    const page = searchParams.get("page") || "1";

    // Build filter object
    const filter: any = {};

    // Search by title or content
    if (query) {
      filter.$or = [
        { title: { $regex: query, $options: "i" } },
        { content: { $regex: query, $options: "i" } },
      ];
    }

    // Filter by category
    if (category) {
      filter.category = category;
    }

    // Build sort object (only newest and oldest)
    let sortObj: any = { createdAt: -1 }; // Default sort (newest)
    if (sort === "-createdAt") {
      sortObj = { createdAt: -1 }; // Newest
    } else if (sort === "createdAt") {
      sortObj = { createdAt: 1 }; // Oldest
    }

    // Build query
    let blogsQuery = Blog.find(filter).populate("category", "name slug");

    // Apply sorting
    blogsQuery = blogsQuery.sort(sortObj);

    // Apply limit if specified
    if (limit && !isNaN(parseInt(limit))) {
      blogsQuery = blogsQuery.limit(parseInt(limit));
    }

    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = limit ? parseInt(limit) : 12;
    if (pageNum > 1 && !limit) {
      blogsQuery = blogsQuery.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const blogs = await blogsQuery;

    // Get total count for pagination
    const total = await Blog.countDocuments(filter);

    return NextResponse.json(blogs, {
      status: 200,
      headers: {
        "X-Total-Count": total.toString(),
        "X-Page": page,
        "X-Limit": limit || "12",
      },
    });
  } catch (error) {
    console.warn("Blogs unavailable (DB bypass):", error);
    return NextResponse.json([], {
      status: 200,
      headers: { "X-Total-Count": "0", "X-Page": "1", "X-Limit": "12" },
    });
  }
}

// PUT update a blog
export async function PUT(req: NextRequest) {
  try {
    const isAdmin = await validateAdmin();
    if (!isAdmin) {
      return NextResponse.json(
        { message: "Unauthorized: Admin access required" },
        { status: 403 },
      );
    }

    await connectDB();

    const formData = await req.formData();

    const id = String(formData.get("id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const content = String(formData.get("content") || "").trim();
    const author = String(formData.get("author") || "").trim();
    const category = String(formData.get("category") || "").trim();

    // Get thumbnail file (optional for updates)
    let thumbnailFile: File | null = null;
    for (const [key, value] of formData.entries()) {
      if (key === "thumbnail" && value instanceof File) {
        thumbnailFile = value;
        break;
      }
    }

    if (!id) {
      return NextResponse.json(
        { error: "Blog ID is required" },
        { status: 400 },
      );
    }

    // Find existing blog
    const existingBlog = await Blog.findById(id);
    if (!existingBlog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    // Generate new slug if title changed
    let slug = existingBlog.slug;
    if (title && title !== existingBlog.title) {
      slug = generateSlug(title);

      // Check if new slug already exists (excluding current blog)
      const slugExists = await Blog.findOne({
        slug,
        _id: { $ne: id },
      });
      if (slugExists) {
        return NextResponse.json(
          { error: "Blog with this title already exists" },
          { status: 409 },
        );
      }
    }

    // Verify category exists if changed
    let categoryId = existingBlog.category;
    if (category && category !== existingBlog.category?.toString()) {
      const categoryExists = await BlogCategory.findById(category);
      if (!categoryExists) {
        return NextResponse.json(
          { error: "Blog category not found" },
          { status: 404 },
        );
      }
      categoryId = category;
    }

    // Upload new thumbnail to Cloudinary if provided
    let thumbnailUrl = existingBlog.thumbnail;
    if (thumbnailFile) {
      try {
        const arrayBuffer = await thumbnailFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString("base64");
        const dataUri = `data:${thumbnailFile.type};base64,${base64}`;

        const result = await cloudinary.uploader.upload(dataUri, {
          folder: "ElegantEcommerce/blogs",
          transformation: [{ width: 800, height: 450, crop: "limit" }],
        });

        thumbnailUrl = result.secure_url;
      } catch (error) {
        console.error("Error uploading thumbnail to Cloudinary:", error);
        return NextResponse.json(
          { error: "Failed to upload thumbnail image" },
          { status: 500 },
        );
      }
    }

    // Update blog
    const updatedBlog = await Blog.findByIdAndUpdate(
      id,
      {
        title: title || existingBlog.title,
        slug,
        content: content || existingBlog.content,
        author: author || existingBlog.author,
        category: categoryId,
        thumbnail: thumbnailUrl,
      },
      { new: true },
    ).populate("category", "name slug");

    revalidatePath("/admin/blogs");
    return NextResponse.json(
      {
        success: true,
        message: "Blog updated successfully",
        blog: updatedBlog,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error updating blog:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update blog",
      },
      { status: 500 },
    );
  }
}

// DELETE a blog
export async function DELETE(request: NextRequest) {
  try {
    const isAdmin = await validateAdmin();
    if (!isAdmin) {
      return NextResponse.json(
        { message: "Unauthorized: Admin access required" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Blog ID is required" },
        { status: 400 },
      );
    }

    await connectDB();

    const deletedBlog = await Blog.findByIdAndDelete(id);

    if (!deletedBlog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    revalidatePath("/admin/blogs");
    return NextResponse.json(
      { message: "Blog deleted successfully" },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error deleting blog:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to delete blog",
      },
      { status: 500 },
    );
  }
}
