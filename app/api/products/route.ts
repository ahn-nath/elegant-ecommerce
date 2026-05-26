import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { Product } from "@/models/Product";
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

    // Parse FormData directly (App Router compatible)
    const formData = await req.formData();

    // Extract form fields
    const name = String(formData.get("name") || "").trim();
    const price = String(formData.get("price") || "").trim();
    const category = String(formData.get("category") || "").trim();
    const stock = String(formData.get("stock") || "").trim();
    const colors = String(formData.get("colors") || "").trim();

    // Get image files
    const imageFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "images" && value instanceof File) {
        imageFiles.push(value);
      }
    }

    console.log("Form data received:", {
      name,
      price,
      category,
      stock,
      colors,
      imageCount: imageFiles.length,
    });

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: "Product name is required" },
        { status: 400 },
      );
    }

    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
      return NextResponse.json(
        { error: "Valid price is required" },
        { status: 400 },
      );
    }

    if (!category) {
      return NextResponse.json(
        { error: "Category is required" },
        { status: 400 },
      );
    }

    if (!stock || isNaN(parseInt(stock)) || parseInt(stock) < 0) {
      return NextResponse.json(
        { error: "Valid stock quantity is required" },
        { status: 400 },
      );
    }

    // Generate slug from name
    const slug = generateSlug(name);

    // Check if product with same slug already exists
    const existingProduct = await Product.findOne({ slug });
    if (existingProduct) {
      return NextResponse.json(
        { error: "Product with this name already exists" },
        { status: 409 },
      );
    }

    // Verify category exists
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 },
      );
    }

    // Upload images to Cloudinary
    const imageUrls: string[] = [];
    for (const file of imageFiles) {
      try {
        // Convert file to base64
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString("base64");
        const dataUri = `data:${file.type};base64,${base64}`;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataUri, {
          folder: "ElegantEcommerce/products",
          transformation: [{ width: 800, height: 800, crop: "limit" }],
        });

        imageUrls.push(result.secure_url);
        console.log(`Uploaded image: ${result.secure_url}`);
      } catch (error) {
        console.error("Error uploading image to Cloudinary:", error);
        return NextResponse.json(
          { error: "Failed to upload images to Cloudinary" },
          { status: 500 },
        );
      }
    }

    // Parse colors (comma-separated string to array)
    const colorsArray = colors
      ? colors
          .split(",")
          .map((c: string) => c.trim())
          .filter(Boolean)
      : [];

    // Create new product
    const newProduct = new Product({
      name,
      slug,
      price: parseFloat(price),
      category,
      stock: parseInt(stock),
      colors: colorsArray,
      images: imageUrls,
    });

    await newProduct.save();

    // Populate category details in response
    const populatedProduct = await Product.findById(newProduct._id).populate(
      "category",
      "name slug",
    );

    // Revalidate the admin products page
    revalidatePath("/admin/products");

    return NextResponse.json(
      {
        success: true,
        message: "Product created successfully",
        product: populatedProduct,
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("Error creating product:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create product",
      },
      { status: 500 },
    );
  }
}

// GET all products with category details
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") || "";
    const category = searchParams.get("category") || "";
    const price = searchParams.get("price") || "";
    const sort = searchParams.get("sort") || "-createdAt";
    const limit = searchParams.get("limit") || "";
    const page = searchParams.get("page") || "1";

    // Build filter object
    const filter: any = {};

    // Search by name
    if (query) {
      filter.name = { $regex: query, $options: "i" };
    }

    // Filter by category
    if (category) {
      filter.category = category;
    }

    // Filter by price range
    if (price) {
      if (price === "0-100") {
        filter.price = { $gte: 0, $lte: 100 };
      } else if (price === "100-200") {
        filter.price = { $gte: 100, $lte: 200 };
      } else if (price === "200+") {
        filter.price = { $gte: 200 };
      }
    }

    // Build sort object
    let sortObj: any = { createdAt: -1 }; // Default sort
    if (sort) {
      if (sort === "-createdAt") {
        sortObj = { createdAt: -1 };
      } else if (sort === "createdAt") {
        sortObj = { createdAt: 1 };
      } else if (sort === "price") {
        sortObj = { price: 1 };
      } else if (sort === "-price") {
        sortObj = { price: -1 };
      } else if (sort === "name") {
        sortObj = { name: 1 };
      } else if (sort === "-name") {
        sortObj = { name: -1 };
      }
    }

    // Build query
    let productsQuery = Product.find(filter).populate("category", "name slug");

    // Apply sorting
    productsQuery = productsQuery.sort(sortObj);

    // Apply limit if specified
    if (limit && !isNaN(parseInt(limit))) {
      productsQuery = productsQuery.limit(parseInt(limit));
    }

    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = limit ? parseInt(limit) : 12;
    if (pageNum > 1 && !limit) {
      productsQuery = productsQuery
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum);
    }

    const products = await productsQuery;

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    return NextResponse.json(products, {
      status: 200,
      headers: {
        "X-Total-Count": total.toString(),
        "X-Page": page,
        "X-Limit": limit || "12",
      },
    });
  } catch (error) {
    console.warn("Products unavailable (DB bypass):", error);
    return NextResponse.json([], {
      status: 200,
      headers: { "X-Total-Count": "0", "X-Page": "1", "X-Limit": "12" },
    });
  }
}

// PUT update a product
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
    const price = String(formData.get("price") || "").trim();
    const category = String(formData.get("category") || "").trim();
    const stock = String(formData.get("stock") || "").trim();
    const colors = String(formData.get("colors") || "").trim();
    const existingImages = String(formData.get("images") || "[]");

    // Get new image files
    const imageFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "images" && value instanceof File) {
        imageFiles.push(value);
      }
    }

    if (!id) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 },
      );
    }

    // Find existing product
    const existingProduct = await Product.findById(id);
    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Generate new slug if name changed
    let slug = existingProduct.slug;
    if (name && name !== existingProduct.name) {
      slug = generateSlug(name);

      // Check if new slug already exists (excluding current product)
      const slugExists = await Product.findOne({
        slug,
        _id: { $ne: id },
      });
      if (slugExists) {
        return NextResponse.json(
          { error: "Product with this name already exists" },
          { status: 409 },
        );
      }
    }

    // Verify category exists if changed
    if (category && category !== existingProduct.category.toString()) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        return NextResponse.json(
          { error: "Category not found" },
          { status: 404 },
        );
      }
    }

    // Upload new images to Cloudinary
    const newImageUrls: string[] = [];
    for (const file of imageFiles) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString("base64");
        const dataUri = `data:${file.type};base64,${base64}`;

        const result = await cloudinary.uploader.upload(dataUri, {
          folder: "ElegantEcommerce/products",
          transformation: [{ width: 800, height: 800, crop: "limit" }],
        });

        newImageUrls.push(result.secure_url);
      } catch (error) {
        console.error("Error uploading image to Cloudinary:", error);
        return NextResponse.json(
          { error: "Failed to upload images to Cloudinary" },
          { status: 500 },
        );
      }
    }

    // Use new images if uploaded, otherwise keep existing ones
    const images =
      newImageUrls.length > 0 ? newImageUrls : JSON.parse(existingImages);

    // Validate images (max 6)
    if (images.length > 6) {
      return NextResponse.json(
        { error: "Maximum 6 images allowed per product" },
        { status: 400 },
      );
    }

    // Parse colors
    const colorsArray = colors
      ? colors
          .split(",")
          .map((c: string) => c.trim())
          .filter(Boolean)
      : existingProduct.colors;

    // Update product
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      {
        name: name || existingProduct.name,
        slug,
        price: price ? parseFloat(price) : existingProduct.price,
        category: category || existingProduct.category,
        stock: stock !== undefined ? parseInt(stock) : existingProduct.stock,
        images,
        colors: colorsArray,
      },
      { new: true },
    ).populate("category", "name slug");

    revalidatePath("/admin/products");
    return NextResponse.json(
      {
        success: true,
        message: "Product updated successfully",
        product: updatedProduct,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error updating product:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update product",
      },
      { status: 500 },
    );
  }
}

// DELETE a product
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
        { error: "Product ID is required" },
        { status: 400 },
      );
    }

    await connectDB();

    const deletedProduct = await Product.findByIdAndDelete(id);

    if (!deletedProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    revalidatePath("/admin/products");
    return NextResponse.json(
      { message: "Product deleted successfully" },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to delete product",
      },
      { status: 500 },
    );
  }
}
