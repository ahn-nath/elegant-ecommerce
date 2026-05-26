import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { BlogCategory } from "@/models/BlogCategory";
import { validateAdmin } from "@/lib/admin-guard";
import { revalidatePath } from "next/cache";

// Helper function to generate slug from name
function generateSlug(name: string): string {
  return name
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

    const body = await req.json();
    const { name, description } = body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.trim() === "") {
      return NextResponse.json(
        { error: "Category name is required" },
        { status: 400 },
      );
    }

    const trimmedName = name.trim();
    const slug = generateSlug(trimmedName);

    // Check if category with same slug already exists
    const existingCategory = await BlogCategory.findOne({ slug });
    if (existingCategory) {
      return NextResponse.json(
        { error: "Category with this name already exists" },
        { status: 409 },
      );
    }

    // Create new category
    const newCategory = new BlogCategory({
      name: trimmedName,
      slug,
      description: description?.trim() || "",
    });

    await newCategory.save();

    // Revalidate relevant pages
    revalidatePath("/admin/categories");
    revalidatePath("/admin/blogs");

    return NextResponse.json(
      {
        success: true,
        message: "Category created successfully",
        category: newCategory,
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("Error creating category:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create category",
      },
      { status: 500 },
    );
  }
}

// GET all blog categories
export async function GET() {
  try {
    await connectDB();
    const categories = await BlogCategory.find({}).sort({ name: 1 });
    return NextResponse.json(categories, { status: 200 });
  } catch (error) {
    console.warn("Blog categories unavailable (DB bypass):", error);
    return NextResponse.json([], { status: 200 });
  }
}

// PUT update a blog category
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

    const body = await req.json();
    const { id, name, description } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 },
      );
    }

    // Find existing category
    const existingCategory = await BlogCategory.findById(id);
    if (!existingCategory) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 },
      );
    }

    // Generate new slug if name changed
    let slug = existingCategory.slug;
    if (name && name !== existingCategory.name) {
      const trimmedName = name.trim();
      slug = generateSlug(trimmedName);

      // Check if new slug already exists (excluding current category)
      const slugExists = await BlogCategory.findOne({
        slug,
        _id: { $ne: id },
      });
      if (slugExists) {
        return NextResponse.json(
          { error: "Category with this name already exists" },
          { status: 409 },
        );
      }
    }

    // Update category
    const updatedCategory = await BlogCategory.findByIdAndUpdate(
      id,
      {
        name: name?.trim() || existingCategory.name,
        slug,
        description: description?.trim() || existingCategory.description,
      },
      { new: true },
    );

    revalidatePath("/admin/categories");
    revalidatePath("/admin/blogs");

    return NextResponse.json(
      {
        success: true,
        message: "Category updated successfully",
        category: updatedCategory,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error updating category:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update category",
      },
      { status: 500 },
    );
  }
}

// DELETE a blog category
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
        { error: "Category ID is required" },
        { status: 400 },
      );
    }

    await connectDB();

    // Check if any blogs are using this category
    const { Blog } = await import("@/models/Blog");
    const blogsUsingCategory = await Blog.findOne({ category: id });

    if (blogsUsingCategory) {
      return NextResponse.json(
        {
          error:
            "Cannot delete category. There are blogs using this category. Please reassign or delete those blogs first.",
        },
        { status: 400 },
      );
    }

    const deletedCategory = await BlogCategory.findByIdAndDelete(id);

    if (!deletedCategory) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 },
      );
    }

    revalidatePath("/admin/categories");
    revalidatePath("/admin/blogs");

    return NextResponse.json(
      { message: "Category deleted successfully" },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error deleting category:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to delete category",
      },
      { status: 500 },
    );
  }
}
