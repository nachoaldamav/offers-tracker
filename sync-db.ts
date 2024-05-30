import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config('.env.test');

const connect = async () => {
  try {
    await mongoose.connect(`mongodb://${process.env.MONGO_URL}:27017/egdata`, {
      auth: {
        username: process.env.MONGO_USER,
        password: process.env.MONGO_PASSWORD,
      },
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Error connecting to MongoDB: ', error);
  }
};

function generateShortId(originalId: string) {
  // Create a SHA-256 hash of the original ID
  const hash = crypto.createHash('sha256').update(originalId).digest('hex');

  // Convert the hash to a BigInt
  const bigIntHash = BigInt(`0x${hash}`);

  // Convert the BigInt to a base36 string (a-z, 0-9)
  const shortId = bigIntHash.toString(36);

  // Truncate the short ID to 7 characters
  return shortId.slice(0, 7);
}

async function main() {
  const localDBDir = path.join(__dirname, 'database', 'offers');
  const files = glob.sync('**/*.json', { cwd: localDBDir, absolute: true });
  const offers: Offer[] = [];

  for (const file of files) {
    const data = fs.readFileSync(file, 'utf-8');
    const offersData = JSON.parse(data) as Offer;
    offers.push({
      ...offersData,
      _id: generateShortId(offersData.id),
      // Convert dates to Date objects
      effectiveDate: new Date(offersData.effectiveDate),
      creationDate: new Date(offersData.creationDate),
      lastModifiedDate: new Date(offersData.lastModifiedDate),
      releaseDate: offersData.releaseDate
        ? new Date(offersData.releaseDate)
        : undefined,
      pcReleaseDate: offersData.pcReleaseDate
        ? new Date(offersData.pcReleaseDate)
        : undefined,
      viewableDate: offersData.viewableDate
        ? new Date(offersData.viewableDate)
        : undefined,
    });
  }

  await connect();
  const KeyImage = mongoose.model(
    'KeyImage',
    new mongoose.Schema({
      type: String,
      url: String,
    })
  );

  const Offer = mongoose.model(
    'Offer',
    new mongoose.Schema({
      _id: String,
      title: String,
      id: String,
      namespace: String,
      description: String,
      effectiveDate: Date,
      creationDate: Date,
      lastModifiedDate: Date,
      isCodeRedemptionOnly: Boolean,
      keyImages: [KeyImage.schema],
      currentPrice: Number,
      seller: {
        id: String,
        name: String,
      },
      productSlug: String,
      urlSlug: String,
      url: String,
      tags: [
        {
          id: String,
          name: String,
        },
      ],
      items: [
        {
          id: String,
          namespace: String,
        },
      ],
      customAttributes: [
        {
          key: String,
          value: String,
        },
      ],
      categories: [
        {
          path: String,
        },
      ],
      catalogNs: {
        mappings: [
          {
            pageSlug: String,
            pageType: String,
          },
        ],
        name: String,
      },
      offerMappings: [
        {
          pageSlug: String,
          pageType: String,
        },
      ],
      developerDisplayName: String,
      publisherDisplayName: String,
      price: {
        totalPrice: {
          discountPrice: Number,
          originalPrice: Number,
          voucherDiscount: Number,
          discount: Number,
          currencyCode: String,
          currencyInfo: {
            decimals: Number,
          },
          fmtPrice: String,
        },
        lineOffers: [
          {
            appliedRules: [
              {
                id: String,
              },
            ],
          },
        ],
      },
      prePurchase: Boolean,
      releaseDate: Date,
      pcReleaseDate: Date,
      viewableDate: Date,
      offerType: String,
      longDescription: String,
      status: String,
      developer: String,
      linkedOfferId: String,
      isFeatured: Boolean,
      ignoreOrder: Boolean,
      freeDays: Number,
      collectionOfferIds: [String],
      technicalDetails: String,
      recurrence: String,
    })
  );

  await Offer.deleteMany({});

  await Offer.insertMany(
    offers.map((offer) => {
      const offerDoc = new Offer({
        ...offer,
        keyImages: offer.keyImages.map((keyImage) => ({
          type: keyImage.type,
          url: keyImage.url,
        })),
      });
      return offerDoc;
    })
  );

  console.log('Offers synced to MongoDB');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

export interface Offer {
  _id: string;
  title: string;
  id: string;
  namespace: string;
  description: string;
  effectiveDate: string;
  creationDate: string;
  lastModifiedDate: string;
  isCodeRedemptionOnly?: boolean;
  keyImages: KeyImage[];
  currentPrice?: number;
  seller: Seller;
  productSlug?: string;
  urlSlug: string;
  url: any;
  tags: Tag[];
  items: Item[];
  customAttributes: CustomAttribute[];
  categories: Category[];
  catalogNs: CatalogNs;
  offerMappings?: OfferMapping[];
  developerDisplayName?: string;
  publisherDisplayName?: string;
  price?: Price;
  prePurchase?: boolean;
  releaseDate?: Date;
  pcReleaseDate?: Date;
  viewableDate?: Date;
  approximateReleasePlan: any;
  offerType?: string;
  longDescription?: string;
  status?: string;
  developer: any;
  linkedOfferId: any;
  isFeatured?: boolean;
  ignoreOrder?: boolean;
  freeDays?: number;
  collectionOfferIds?: any[];
  technicalDetails: any;
  recurrence?: string;
}

export interface KeyImage {
  type: string;
  url: string;
  md5?: string;
  size?: number;
  uploadedDate?: string;
  width?: number;
  height?: number;
}

export interface Seller {
  id: string;
  name: string;
}

export interface Tag {
  id: string;
  name: string;
  namespace?: string;
  aliases?: any[];
  operator: any;
  created?: string;
  updated?: string;
  status?: string;
  referenceCount?: number;
  comment?: string;
}

export interface Item {
  id: string;
  namespace?: string;
}

export interface CustomAttribute {
  key: string;
  value: string;
}

export interface Category {
  path: string;
}

export interface CatalogNs {
  mappings?: Mapping[];
  name?: string;
}

export interface Mapping {
  pageSlug: string;
  pageType: string;
}

export interface OfferMapping {
  pageSlug: string;
  pageType: string;
}

export interface Price {
  totalPrice: TotalPrice;
  lineOffers: LineOffer[];
}

export interface TotalPrice {
  discountPrice: number;
  originalPrice: number;
  voucherDiscount: number;
  discount: number;
  currencyCode: string;
  currencyInfo: CurrencyInfo;
  fmtPrice: any;
}

export interface CurrencyInfo {
  decimals: number;
}

export interface LineOffer {
  appliedRules: AppliedRule[];
}

export interface AppliedRule {
  id: string;
}
