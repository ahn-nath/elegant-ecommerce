import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { Category } from "@/models/Category";
import { validateAdmin } from "@/lib/admin-guard";
import cloudinary from "@/lib/cloudinary";
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

    // Parse FormData for product categories (may include image)
    const formData = await req.formData();

    // Extract form fields
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();

    // Get image file (optional for product categories)
    let imageFile: File | null = null;
    for (const [key, value] of formData.entries()) {
      if (key === "image" && value instanceof File) {
        imageFile = value;
        break;
      }
    }

    console.log("Product category form data received:", {
      name,
      description,
      hasImage: !!imageFile,
    });

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
    const existingCategory = await Category.findOne({ slug });
    if (existingCategory) {
      return NextResponse.json(
        { error: "Category with this name already exists" },
        { status: 409 },
      );
    }

    // Upload image to Cloudinary if provided
    let imageUrl = "";
    if (imageFile) {
      try {
        // Convert file to base64
        const arrayBuffer = await imageFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString("base64");
        const dataUri = `data:${imageFile.type};base64,${base64}`;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataUri, {
          folder: "ElegantEcommerce/categories",
          transformation: [{ width: 400, height: 400, crop: "limit" }],
        });

        imageUrl = result.secure_url;
        console.log(`Uploaded category image: ${imageUrl}`);
      } catch (error) {
        console.error("Error uploading category image to Cloudinary:", error);
        return NextResponse.json(
          { error: "Failed to upload category image" },
          { status: 500 },
        );
      }
    }

    // Create new category
    const newCategory = new Category({
      name: trimmedName,
      slug,
      description: description?.trim() || "",
      image: imageUrl,
    });

    await newCategory.save();

    // Revalidate relevant pages
    revalidatePath("/admin/categories");
    revalidatePath("/admin/products");

    return NextResponse.json(
      {
        success: true,
        message: "Product category created successfully",
        category: newCategory,
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("Error creating product category:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create product category",
      },
      { status: 500 },
    );
  }
}

// GET all product categories
export async function GET() {
  try {
    await connectDB();
    const categories = await Category.find({}).sort({ name: 1 });
    return NextResponse.json(categories, { status: 200 });
  } catch (error) {
    console.warn("Product categories unavailable (DB bypass):", error);
    return NextResponse.json([], { status: 200 });
  }
}

// PUT update a product category
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
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();

    // Get image file (optional for updates)
    let imageFile: File | null = null;
    for (const [key, value] of formData.entries()) {
      if (key === "image" && value instanceof File) {
        imageFile = value;
        break;
      }
    }

    if (!id) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 },
      );
    }

    // Find existing category
    const existingCategory = await Category.findById(id);
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
      const slugExists = await Category.findOne({
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

    // Upload new image to Cloudinary if provided
    let imageUrl = existingCategory.image;
    if (imageFile) {
      try {
        const arrayBuffer = await imageFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString("base64");
        const dataUri = `data:${imageFile.type};base64,${base64}`;

        const result = await cloudinary.uploader.upload(dataUri, {
          folder: "ElegantEcommerce/categories",
          transformation: [{ width: 400, height: 400, crop: "limit" }],
        });

        imageUrl = result.secure_url;
      } catch (error) {
        console.error("Error uploading category image to Cloudinary:", error);
        return NextResponse.json(
          { error: "Failed to upload category image" },
          { status: 500 },
        );
      }
    }

    // Update category
    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      {
        name: name?.trim() || existingCategory.name,
        slug,
        description: description?.trim() || existingCategory.description,
        image: imageUrl,
      },
      { new: true },
    );

    revalidatePath("/admin/categories");
    revalidatePath("/admin/products");

    return NextResponse.json(
      {
        success: true,
        message: "Product category updated successfully",
        category: updatedCategory,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error updating product category:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update product category",
      },
      { status: 500 },
    );
  }
}

// DELETE a product category
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

    // Check if any products are using this category
    const { Product } = await import("@/models/Product");
    const productsUsingCategory = await Product.findOne({ category: id });

    if (productsUsingCategory) {
      return NextResponse.json(
        {
          error:
            "Cannot delete category. There are products using this category. Please reassign or delete those products first.",
        },
        { status: 400 },
      );
    }

    const deletedCategory = await Category.findByIdAndDelete(id);

    if (!deletedCategory) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 },
      );
    }

    revalidatePath("/admin/categories");
    revalidatePath("/admin/products");

    return NextResponse.json(
      { message: "Product category deleted successfully" },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error deleting product category:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to delete product category",
      },
      { status: 500 },
    );
  }
}
