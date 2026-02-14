import seedListings from "./seedListings.json";
import { dbConnect, Listing } from "./db";

function normalizeListingDoc(listing) {
  const obj =
    typeof listing?.toObject === "function" ? listing.toObject() : listing;
  const propertyCategory =
    typeof obj?.propertyCategory === "string" ? obj.propertyCategory : "";
  const propertyType = typeof obj?.propertyType === "string" ? obj.propertyType : "";
  const normalizedPropertyType =
    propertyCategory === "commercial" && propertyType === "Retail"
      ? "Retail warehouse"
      : propertyType;
  return {
    ...obj,
    propertyType: normalizedPropertyType,
    shortId: typeof obj?.shortId === "string" ? obj.shortId : "",
    _id: obj?._id?.toString?.() ?? obj?._id,
    createdAt: obj?.createdAt?.toISOString?.() ?? obj?.createdAt,
    updatedAt: obj?.updatedAt?.toISOString?.() ?? obj?.updatedAt,
  };
}

function stableShortIdSeed(value) {
  const seed = String(value || "");
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const base36 = Math.abs(hash).toString(36).toUpperCase().padStart(4, "0");
  return base36.slice(0, 4).replace(/[^A-Z0-9]/g, "A");
}

function withSeedShortId(listing, indexHint = 0) {
  if (!listing || typeof listing !== "object") return listing;
  if (typeof listing.shortId === "string" && /^[A-Z0-9]{4}$/.test(listing.shortId)) return listing;
  const seed = [
    listing._id,
    listing.title,
    listing.suburb,
    listing.pricePerMonth,
    listing.price,
    indexHint,
  ]
    .filter((v) => v !== undefined && v !== null)
    .join("|");
  return { ...listing, shortId: stableShortIdSeed(seed) };
}

function toSafeString(value) {
  return typeof value === "string" ? value : "";
}

function toSafeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function normalizeText(value) {
  return toSafeString(value).trim().toLowerCase();
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim());
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALLOWED_SORTS = new Set(["newest", "price_asc", "price_desc", "beds_asc", "beds_desc"]);

export const KNOWN_PROPERTY_CATEGORIES = ["residential", "boarding", "commercial", "land"];

export const KNOWN_PROPERTY_TYPES_BY_CATEGORY = {
  residential: ["Apartment", "House", "Cottage", "Garden flat", "Townhouse"],
  boarding: ["Boarding house (university)", "Boarding house", "Student accommodation", "Room"],
  commercial: ["Office", "Shop", "Retail warehouse", "Warehouse", "Factory", "Workshop"],
  land: ["Farm", "Stand", "Plot"],
};

function mergeStringLists(...lists) {
  return Array.from(
    new Set(lists.flatMap((list) => (Array.isArray(list) ? list : []))),
  )
    .map((value) => toSafeString(value).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function mergeTypesByCategory(existing = {}) {
  const result = { ...existing };
  for (const category of KNOWN_PROPERTY_CATEGORIES) {
    const current = Array.isArray(result[category]) ? result[category] : [];
    const known = KNOWN_PROPERTY_TYPES_BY_CATEGORY[category] || [];
    result[category] = mergeStringLists(current, known);
  }
  return result;
}

function normalizeRangeNumbers(minValue, maxValue, { integer = false } = {}) {
  const minRaw = toSafeNumber(minValue);
  const maxRaw = toSafeNumber(maxValue);
  const min = minRaw === null ? null : (integer ? Math.floor(minRaw) : minRaw);
  const max = maxRaw === null ? null : (integer ? Math.floor(maxRaw) : maxRaw);

  const minSafe = min !== null && min >= 0 ? min : null;
  const maxSafe = max !== null && max >= 0 ? max : null;

  if (minSafe !== null && maxSafe !== null && maxSafe < minSafe) {
    return { min: maxSafe, max: minSafe };
  }

  return { min: minSafe, max: maxSafe };
}

export async function getPublishedListings({ limit = 6 } = {}) {
  if (!process.env.MONGODB_URI) {
    return seedListings
      .filter((listing) => listing?.status === "published")
      .slice(0, limit)
      .map((l, i) => withSeedShortId(l, i));
  }

  await dbConnect();
  const listings = await Listing.find({ status: "published" })
    .sort({ createdAt: -1 })
    .limit(limit);
  await Promise.all(
    listings
      .filter((l) => l && typeof l === "object" && !l.shortId)
      .map(async (l) => {
        try {
          l.shortId = undefined;
          l.markModified("shortId");
          await l.save();
        } catch (e) { }
      }),
  );
  return listings.map(normalizeListingDoc);
}

export async function searchListings({
  status = "published",
  q = "",
  city = "",
  suburb = "",
  propertyCategory = "",
  propertyType = "",
  minPrice = null,
  maxPrice = null,
  minDeposit = null,
  maxDeposit = null,
  minBeds = null,
  maxBeds = null,
  features = [],
  sort = "newest",
  page = 1,
  perPage = 24,
  photos = false,
} = {}) {
  const normalizedStatus = status === "all" ? "all" : "published";
  const safeQuery = toSafeString(q).slice(0, 120);
  const safePropertyType = toSafeString(propertyType).slice(0, 80);
  const normalizedQuery = normalizeText(safeQuery);
  const normalizedCity = normalizeText(city);
  const normalizedSuburb = normalizeText(suburb);
  const normalizedCategory = normalizeText(propertyCategory);
  const normalizedType = normalizeText(safePropertyType);
  const normalizedTypeAliases =
    normalizedType === "retail warehouse"
      ? new Set(["retail warehouse", "retail"])
      : new Set([normalizedType]);
  const selectedFeatures = toStringArray(features).slice(0, 12);
  const selectedFeaturesNormalized = selectedFeatures.map((f) =>
    normalizeText(f),
  );

  const pageNumber = Math.max(1, Math.floor(toSafeNumber(page) ?? 1));
  const perPageNumberRaw = Math.floor(toSafeNumber(perPage) ?? 24);
  const perPageNumber = Math.min(60, Math.max(1, perPageNumberRaw));
  const skip = (pageNumber - 1) * perPageNumber;

  const priceRange = normalizeRangeNumbers(minPrice, maxPrice);
  const depositRange = normalizeRangeNumbers(minDeposit, maxDeposit);
  const bedsRange = normalizeRangeNumbers(minBeds, maxBeds, { integer: true });
  const minPriceNumber = priceRange.min;
  const maxPriceNumber = priceRange.max;
  const minDepositNumber = depositRange.min;
  const maxDepositNumber = depositRange.max;
  const minBedsNumber = bedsRange.min;
  const maxBedsNumber = bedsRange.max;
  const normalizedSort = ALLOWED_SORTS.has(sort) ? sort : "newest";

  const hasMongo = Boolean(process.env.MONGODB_URI);

  if (!hasMongo) {
    const base = seedListings.filter((listing) => {
      if (!listing || typeof listing !== "object") return false;
      if (normalizedStatus === "published" && listing.status !== "published") {
        return false;
      }
      if (normalizedCategory) {
        const listingCategory = normalizeText(listing.propertyCategory);
        if (listingCategory !== normalizedCategory) return false;
      }
      if (normalizedType) {
        const listingType = normalizeText(listing.propertyType);
        if (!normalizedTypeAliases.has(listingType)) return false;
      }
      if (photos && !(Array.isArray(listing.images) && listing.images.length)) {
        return false;
      }
      if (normalizedCity) {
        const listingSuburb = normalizeText(listing.suburb);
        if (!listingSuburb.includes(normalizedCity)) return false;
      }
      if (normalizedSuburb) {
        const listingSuburb = normalizeText(listing.suburb);
        if (!listingSuburb.includes(normalizedSuburb)) return false;
      }
      if (minPriceNumber !== null) {
        const price = toSafeNumber(listing.pricePerMonth);
        if (price === null || price < minPriceNumber) return false;
      }
      if (maxPriceNumber !== null) {
        const price = toSafeNumber(listing.pricePerMonth);
        if (price === null || price > maxPriceNumber) return false;
      }
      if (minDepositNumber !== null) {
        const deposit = toSafeNumber(listing.deposit);
        if (deposit === null || deposit < minDepositNumber) return false;
      }
      if (maxDepositNumber !== null) {
        const deposit = toSafeNumber(listing.deposit);
        if (deposit === null || deposit > maxDepositNumber) return false;
      }
      if (minBedsNumber !== null) {
        const beds = toSafeNumber(listing.bedrooms);
        if (beds === null || beds < minBedsNumber) return false;
      }
      if (maxBedsNumber !== null) {
        const beds = toSafeNumber(listing.bedrooms);
        if (beds === null || beds > maxBedsNumber) return false;
      }
      if (selectedFeaturesNormalized.length) {
        const listingFeatures = toStringArray(listing.features).map((f) =>
          normalizeText(f),
        );
        for (const feature of selectedFeaturesNormalized) {
          if (!listingFeatures.includes(feature)) return false;
        }
      }
      if (normalizedQuery) {
        const haystack = [
          listing.title,
          listing.suburb,
          listing.description,
          ...toStringArray(listing.features),
        ]
          .map((value) => normalizeText(value))
          .filter(Boolean)
          .join(" ");
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });

    const sorted = [...base].sort((a, b) => {
      const aCreated = new Date(a?.createdAt ?? 0).getTime();
      const bCreated = new Date(b?.createdAt ?? 0).getTime();
      const aPrice = toSafeNumber(a?.pricePerMonth) ?? 0;
      const bPrice = toSafeNumber(b?.pricePerMonth) ?? 0;
      const aBeds = toSafeNumber(a?.bedrooms) ?? 0;
      const bBeds = toSafeNumber(b?.bedrooms) ?? 0;

      switch (normalizedSort) {
        case "price_asc":
          return aPrice - bPrice || bCreated - aCreated;
        case "price_desc":
          return bPrice - aPrice || bCreated - aCreated;
        case "beds_asc":
          return aBeds - bBeds || bCreated - aCreated;
        case "beds_desc":
          return bBeds - aBeds || bCreated - aCreated;
        default:
          return bCreated - aCreated;
      }
    });

    const total = sorted.length;
    const listings = sorted.slice(skip, skip + perPageNumber).map((l, i) => withSeedShortId(l, skip + i));
    return { listings, total, page: pageNumber, perPage: perPageNumber };
  }

  await dbConnect();

  const mongoQuery = {};
  if (normalizedStatus === "published") {
    mongoQuery.status = "published";
  }

  if (normalizedCategory) {
    mongoQuery.propertyCategory = normalizedCategory;
  }

  if (normalizedType) {
    if (normalizedType === "retail warehouse") {
      mongoQuery.propertyType = { $in: [/^Retail warehouse$/i, /^Retail$/i] };
    } else {
      mongoQuery.propertyType = { $regex: `^${escapeRegex(safePropertyType.trim())}$`, $options: "i" };
    }
  }

  if (photos) {
    mongoQuery["images.0"] = { $exists: true };
  }

  if (minPriceNumber !== null || maxPriceNumber !== null) {
    mongoQuery.pricePerMonth = {};
    if (minPriceNumber !== null) mongoQuery.pricePerMonth.$gte = minPriceNumber;
    if (maxPriceNumber !== null) mongoQuery.pricePerMonth.$lte = maxPriceNumber;
  }

  if (minDepositNumber !== null || maxDepositNumber !== null) {
    mongoQuery.deposit = {};
    if (minDepositNumber !== null) mongoQuery.deposit.$gte = minDepositNumber;
    if (maxDepositNumber !== null) mongoQuery.deposit.$lte = maxDepositNumber;
  }

  if (minBedsNumber !== null || maxBedsNumber !== null) {
    mongoQuery.bedrooms = {};
    if (minBedsNumber !== null) mongoQuery.bedrooms.$gte = minBedsNumber;
    if (maxBedsNumber !== null) mongoQuery.bedrooms.$lte = maxBedsNumber;
  }

  if (normalizedSuburb) {
    mongoQuery.suburb = { $regex: escapeRegex(suburb.trim()), $options: "i" };
  } else if (normalizedCity) {
    mongoQuery.suburb = { $regex: escapeRegex(city.trim()), $options: "i" };
  }

  if (selectedFeatures.length) {
    mongoQuery.features = { $all: selectedFeatures };
  }

  if (normalizedQuery) {
    const regex = { $regex: escapeRegex(safeQuery.trim()), $options: "i" };
    mongoQuery.$or = [
      { title: regex },
      { suburb: regex },
      { description: regex },
      { features: { $elemMatch: regex } },
    ];
  }

  let sortSpec = { createdAt: -1 };
  switch (normalizedSort) {
    case "price_asc":
      sortSpec = { pricePerMonth: 1, createdAt: -1 };
      break;
    case "price_desc":
      sortSpec = { pricePerMonth: -1, createdAt: -1 };
      break;
    case "beds_asc":
      sortSpec = { bedrooms: 1, createdAt: -1 };
      break;
    case "beds_desc":
      sortSpec = { bedrooms: -1, createdAt: -1 };
      break;
    default:
      sortSpec = { createdAt: -1 };
  }

  const [total, listings] = await Promise.all([
    Listing.countDocuments(mongoQuery),
    Listing.find(mongoQuery).sort(sortSpec).skip(skip).limit(perPageNumber),
  ]);

  await Promise.all(
    listings
      .filter((l) => l && typeof l === "object" && !l.shortId)
      .map(async (l) => {
        try {
          l.shortId = undefined;
          l.markModified("shortId");
          await l.save();
        } catch (e) { }
      }),
  );

  return {
    listings: listings.map(normalizeListingDoc),
    total,
    page: pageNumber,
    perPage: perPageNumber,
  };
}

export async function searchPublishedListings(options = {}) {
  return searchListings({ ...options, status: "published" });
}

export async function getListingFacets() {
  const extraCities = [
    "Beitbridge",
    "Bindura",
    "Bulawayo",
    "Chegutu",
    "Chinhoyi",
    "Chiredzi",
    "Chipinge",
    "Chitungwiza",
    "Gokwe",
    "Gwanda",
    "Gweru",
    "Harare",
    "Hwange",
    "Kadoma",
    "Kariba",
    "Karoi",
    "Kwekwe",
    "Masvingo",
    "Marondera",
    "Mutare",
    "Norton",
    "Plumtree",
    "Rusape",
    "Ruwa",
    "Victoria Falls",
    "Zvishavane",
  ];

  const harareSuburbs = [
    "Arcadia",
    "Ardbennie",
    "Ashdown Park",
    "Aspindale Park",
    "Avondale",
    "Avenues",
    "Ballas",
    "Belgravia",
    "Belvedere",
    "Bluff Hill",
    "Borrowdale",
    "Borrowdale Brooke",
    "Braeside",
    "Budiriro",
    "CBD",
    "Chadcombe",
    "Chisipite",
    "Cleveland",
    "Colne Valley",
    "Cranborne",
    "Crowborough",
    "Dzivarasekwa",
    "Eastlea",
    "Eastview",
    "Emerald Hill",
    "Epworth",
    "Graniteside",
    "Greendale",
    "Glen Lorne",
    "Glen Norah",
    "Glen View",
    "Glen Forest",
    "Gunhill",
    "Hatcliffe",
    "Hatfield",
    "Helensvale",
    "Highfield",
    "Highlands",
    "Hillside",
    "Hogerty Hill",
    "Houghton Park",
    "Kambuzuma",
    "Kensington",
    "Komarock",
    "Kuwadzana",
    "Letombo Park",
    "Mabelreign",
    "Mandara",
    "Marlborough",
    "Mbare",
    "Meyrick Park",
    "Milton Park",
    "Mount Hampden",
    "Mount Pleasant",
    "Msasa",
    "Newlands",
    "Prospect",
    "Quinnington",
    "Ridgeview",
    "Rolf Valley",
    "Rugare",
    "Sandton Park",
    "Sentosa",
    "Shawasha Hills",
    "Southerton",
    "Strathaven",
    "Sunningdale",
    "Sunridge",
    "Tafara",
    "The Grange",
    "Tynwald",
    "Tynwald South",
    "Vainona",
    "Warren Park",
    "Waterfalls",
    "Westgate",
    "Westlea",
    "Willowvale",
    "Windsor Park",
    "Workington",
    "Woodlands",
    "Zimre Park",
  ];

  if (!process.env.MONGODB_URI) {
    const published = seedListings.filter((listing) => {
      return listing && typeof listing === "object" && listing.status === "published";
    });
    const suburbsAll = published
      .map((l) => toSafeString(l.suburb).trim())
      .filter(Boolean);
    const suburbs = Array.from(new Set(suburbsAll)).sort((a, b) => a.localeCompare(b));

    const cities = Array.from(
      new Set(
        suburbs
          .map((value) => {
            const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
            return parts.length > 1 ? parts[parts.length - 1] : "";
          })
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    const suburbsByCity = cities.reduce((acc, city) => {
      const cityLower = normalizeText(city);
      acc[city] = suburbs
        .filter((sub) => normalizeText(sub).includes(cityLower))
        .sort((a, b) => a.localeCompare(b));
      return acc;
    }, {});

    const features = Array.from(
      new Set(
        published
          .flatMap((l) => toStringArray(l.features).map((f) => f.trim()))
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    const propertyCategories = mergeStringLists(
      Array.from(
        new Set(
          published
            .map((l) => toSafeString(l.propertyCategory).trim() || "residential")
            .filter(Boolean),
        ),
      ),
      KNOWN_PROPERTY_CATEGORIES,
    );

    const propertyTypes = mergeStringLists(
      Array.from(
        new Set(published.map((l) => toSafeString(l.propertyType).trim()).filter(Boolean)),
      ),
      Object.values(KNOWN_PROPERTY_TYPES_BY_CATEGORY).flat(),
    );

    const propertyTypesByCategory = propertyCategories.reduce((acc, category) => {
      const types = published
        .filter((l) => (toSafeString(l.propertyCategory).trim() || "residential") === category)
        .map((l) => toSafeString(l.propertyType).trim())
        .filter(Boolean);
      acc[category] = mergeStringLists(types, KNOWN_PROPERTY_TYPES_BY_CATEGORY[category] || []);
      return acc;
    }, {});

    const citiesMerged = Array.from(
      new Set([...cities, ...extraCities].map((value) => toSafeString(value).trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    const harareExtras = harareSuburbs
      .map((name) => `${name}, Harare`)
      .map((value) => toSafeString(value).trim())
      .filter(Boolean);

    const suburbsMerged = Array.from(new Set([...suburbs, ...harareExtras])).sort((a, b) =>
      a.localeCompare(b),
    );

    const suburbsByCityMerged = { ...suburbsByCity };
    const harareExisting = Array.isArray(suburbsByCityMerged.Harare) ? suburbsByCityMerged.Harare : [];
    suburbsByCityMerged.Harare = Array.from(new Set([...harareExisting, ...harareExtras])).sort((a, b) =>
      a.localeCompare(b),
    );

    return {
      cities: citiesMerged,
      suburbs: suburbsMerged,
      suburbsByCity: suburbsByCityMerged,
      features,
      propertyCategories,
      propertyTypes,
      propertyTypesByCategory: mergeTypesByCategory(propertyTypesByCategory),
    };
  }

  await dbConnect();
  const [suburbsRaw, featuresRaw, propertyCategoriesRaw, propertyTypesRaw] = await Promise.all([
    Listing.distinct("suburb", { status: "published" }),
    Listing.distinct("features", { status: "published" }),
    Listing.distinct("propertyCategory", { status: "published" }),
    Listing.distinct("propertyType", { status: "published" }),
  ]);

  const suburbs = toStringArray(suburbsRaw)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const cities = Array.from(
    new Set(
      suburbs
        .map((value) => {
          const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
          return parts.length > 1 ? parts[parts.length - 1] : "";
        })
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const suburbsByCity = cities.reduce((acc, city) => {
    acc[city] = suburbs
      .filter((sub) => normalizeText(sub).includes(normalizeText(city)))
      .sort((a, b) => a.localeCompare(b));
    return acc;
  }, {});
  const features = toStringArray(featuresRaw)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const propertyCategories = mergeStringLists(
    toStringArray(propertyCategoriesRaw).map((s) => s.trim()).filter(Boolean),
    KNOWN_PROPERTY_CATEGORIES,
  );

  const propertyTypes = mergeStringLists(
    toStringArray(propertyTypesRaw).map((s) => s.trim()).filter(Boolean),
    Object.values(KNOWN_PROPERTY_TYPES_BY_CATEGORY).flat(),
  );

  const propertyTypesByCategory = {};
  if (propertyCategories.length) {
    const grouped = await Promise.all(
      propertyCategories.map(async (category) => {
        const types = await Listing.distinct("propertyType", {
          status: "published",
          propertyCategory: category,
        });
        return [category, toStringArray(types).map((t) => t.trim()).filter(Boolean)];
      }),
    );
    for (const [category, types] of grouped) {
      propertyTypesByCategory[category] = mergeStringLists(
        types,
        KNOWN_PROPERTY_TYPES_BY_CATEGORY[category] || [],
      );
    }
  }

  const citiesMerged = Array.from(
    new Set([...cities, ...extraCities].map((value) => toSafeString(value).trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));

  const harareExtras = harareSuburbs
    .map((name) => `${name}, Harare`)
    .map((value) => toSafeString(value).trim())
    .filter(Boolean);

  const suburbsMerged = Array.from(new Set([...suburbs, ...harareExtras])).sort((a, b) =>
    a.localeCompare(b),
  );

  const suburbsByCityMerged = { ...suburbsByCity };
  const harareExisting = Array.isArray(suburbsByCityMerged.Harare) ? suburbsByCityMerged.Harare : [];
  suburbsByCityMerged.Harare = Array.from(new Set([...harareExisting, ...harareExtras])).sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    cities: citiesMerged,
    suburbs: suburbsMerged,
    suburbsByCity: suburbsByCityMerged,
    features,
    propertyCategories,
    propertyTypes,
    propertyTypesByCategory: mergeTypesByCategory(propertyTypesByCategory),
  };
}

export async function getListingById(id) {
  if (!id) return null;

  if (!process.env.MONGODB_URI) {
    const found = seedListings.find((listing) => listing?._id === id) ?? null;
    return found ? withSeedShortId(found, 0) : null;
  }

  await dbConnect();
  const listing = await Listing.findById(id);
  if (!listing) return null;
  return normalizeListingDoc(listing);
}
