export type Mode = "customer" | "merchant" | "driver";
export type ServiceMode = "delivery" | "ride";
export type RideService = "economy" | "comfort" | "moto" | "xl";

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  phoneVerifiedAt?: string | null;
  roles: Array<"customer" | "merchant" | "driver" | "admin">;
  wallet: number;
  defaultAddress?: string;
  restaurantId?: string;
  driverId?: string;
};

export type Restaurant = {
  id: string;
  ownerId: string;
  name: string;
  cuisine: string;
  rating: number;
  etaMin: number;
  deliveryFee: number;
  open: boolean;
  manualOpen?:boolean;
  address: string;
  image: string;
  cover: string;
  badge: string;
  distanceKm: number;
  branches?: Array<{id:string;name:string;address:string;lat:number;lng:number;open:boolean;manualOpen:boolean;status:"active"|"paused"|"closed";etaMin:number;isPrimary:boolean;timezone:string;weeklyHours:Array<{weekday:number;opensAt:string;closesAt:string;enabled:boolean}>;scheduleExceptions:Array<{date:string;isOpen:boolean;opensAt:string|null;closesAt:string|null;reason:string|null}>;inventory:Record<string,{available:boolean;stockQuantity:number|null;version:number}>}>;
  menu: Array<{
    id: string;
    name: string;
    description?: string;
    category?: string;
    price: number;
    stock: boolean;
  modifierGroups?:Array<{id:string;name:string;min:number;max:number;required:boolean;modifiers:Array<{id:string;name:string;price:number;available:boolean}>}>;
  dietaryLabels?:Array<{code:string;name:string}>;
  allergens?:Array<{code:string;name:string;presence:"contains"|"may_contain"}>;
  }>;
};

export type Driver = {
  id: string;
  userId: string;
  name: string;
  online: boolean;
  serviceModes: ServiceMode[];
  activeService: ServiceMode;
  vehicle: string;
  plate: string;
  vehicleKind?: "bicycle"|"motorcycle"|"car"|"van"|null;
  vehicleStatus?: "pending"|"approved"|"rejected"|null;
  rating: number;
  earningsToday: number;
  location: GeoPoint & { label: string; updatedAt?: string | null;source?:"foreground"|"background"|"legacy"|null;accuracyM?:number|null };
};

export type Order = {
  id: string;
  customerId: string;
  restaurantId: string;
  courierId: string | null;
  status: "requested" | "accepted" | "preparing" | "ready_for_pickup" | "courier_assigned" | "picked_up" | "delivering" | "delivered" | "cancelled";
  deliveryAddress: string;
  pickupLocation?:GeoPoint|null;
  deliveryLocation?:GeoPoint|null;
  paymentMethod?: string;
  total: number;
  etaMin: number;
  createdAt?: string;
  items: Array<{ name: string; quantity: number }>;
  cancellation?: ServiceCancellation | null;
};

export type Ride = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: "requested" | "driver_assigned" | "arriving" | "in_progress" | "completed" | "cancelled";
  service?: RideService;
  pickup: string;
  destination: string;
  pickupLocation?: GeoPoint | null;
  destinationLocation?: GeoPoint | null;
  distanceKm: number;
  etaMin?: number;
  durationMin: number;
  fare: number;
  scheduledFor?: string | null;
  cancellation?: ServiceCancellation | null;
};

export type DriverVehicle={id:string;driverId:string;kind:"bicycle"|"motorcycle"|"car"|"van";model:string;plate:string;color:string|null;seats:number|null;serviceModes:ServiceMode[];active:boolean;status:"pending"|"approved"|"rejected";rejectionReason:string|null;reviewedAt:string|null;retiredAt:string|null;createdAt:string;updatedAt:string};
export type OrderIssue={id:string;orderId:string;category:"missing_item"|"wrong_item"|"damaged_item"|"quality"|"late"|"other";description:string;status:"open"|"approved"|"rejected";requestedRefund:number;approvedRefund:number;resolutionNote:string|null;createdAt:string;resolvedAt:string|null};
export type OrderSubstitution={id:string;orderId:string;status:"pending"|"accepted"|"rejected"|"cancelled";quantity:number;reason:string;original:{id:string;name:string;unitPrice:number};replacement:{id:string;name:string;unitPrice:number};refundAmount:number;createdAt:string;decidedAt:string|null};
export type UserAddress={id:string;userId:string;label:string;address:string;lat:number|null;lng:number|null;isDefault:boolean};
export type RideDestination={id:string;label:string;address:string;point:GeoPoint;useCount:number;lastUsedAt:string};

export type RideQuote = {
  service: RideService;
  distanceKm: number;
  etaMin: number;
  durationMin: number;
  fare: number;
  estimated: boolean;
  routingMode: "coordinates" | "text-estimate";
  label?: string;
  description?: string;
  capacity?: number;
  pickupEtaMin?: number;
  availableDrivers?: number;
  available?: boolean;
  quoteId?: string;
  quoteToken?: string;
  expiresAt?: string;
  pricingVersion?: string;
  breakdown?: { baseFare: number; distanceFare: number; timeFare: number; serviceFee: number; tolls: number; demandAdjustment: number; demandMultiplier: number; serviceMultiplier: number };
};

export type CartLine = {
  restaurantId: string;
  item: Restaurant["menu"][number];
  quantity: number;
  extras: string[];
  note: string;
};

export type FoodCheckoutQuote={quoteId:string;quoteToken:string;expiresAt:string;customerId:string;restaurantId:string;branchId:string;deliveryAddressId:string;deliveryAddress:string;distanceKm:number;deliveryFee:number;serviceFee:number;subtotal:number;discount:number;promotionCode:string|null;total:number;etaMin:number;paymentMethod:string;paymentMethodId:string|null;pricingVersion:string;currency:string;items:Array<{menuItemId:string;name:string;quantity:number;baseUnitPrice:number;unitPrice:number;modifiers:Array<{id:string;name:string;price:number;groupId:string;groupName:string}>;note:string}>};

export type Shipment = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: "requested" | "driver_assigned" | "arriving" | "picked_up" | "delivering" | "delivered" | "cancelled";
  pickup: string;
  destination: string;
  pickupLocation?:GeoPoint|null;
  destinationLocation?:GeoPoint|null;
  recipientName: string;
  recipientPhone: string;
  packageSize: "small" | "medium" | "large";
  description: string;
  weightKg: number;
  deliveryNotes: string;
  declaredValue?:number;
  protection?:"none"|"standard";
  protectionPremium?:number;
  signatureRequired?:boolean;
  itemCategory?:"documents"|"standard"|"fragile"|"electronics";
  serviceLevel?:"economy"|"standard"|"priority"|"express";
  handlingInstructions?:string;
  distanceKm: number;
  etaMin: number;
  fare: number;
  deliveryPin?: string;
  deliveryEvidenceCount?:number;
  deliveryVerifiedAt?:string|null;
  timeline?:Array<{status:string;at:string}>;
  cancellation?: ServiceCancellation | null;
};
export type DeliveryEvidence={id:string;shipmentId:string;type:"photo"|"signature";mimeType:"image/jpeg"|"image/png"|"image/webp";sha256:string;sizeBytes:number;capturedLocation:GeoPoint|null;capturedAt:string;createdAt:string;signerName?:string|null;signerRelationship?:"recipient"|"authorized_person"|null;consentVersion?:string|null};

export type ShipmentQuote = {
  packageSize: Shipment["packageSize"];
  distanceKm: number;
  etaMin: number;
  fare: number;
  declaredValue?:number;
  protection?:"none"|"standard";
  protectionPremium?:number;
  deductible?:number;
  itemCategory?:Shipment["itemCategory"];
  itemCategoryName?:string;
  handlingInstructions?:string;
  serviceLevel?:Shipment["serviceLevel"];
  serviceLevelName?:string;
  estimated: boolean;
  routingMode: "coordinates" | "text-estimate";
  pricingVersion?: string;
  quoteId?: string;
  quoteToken?: string;
  expiresAt?: string;
};
export type ShipmentReturn={id:string;shipmentId:string;reason:string;status:"requested"|"approved"|"rejected"|"in_transit"|"completed";resolutionNote:string|null;createdAt:string;updatedAt:string};
export type ShipmentClaimEvidence={id:string;fileName:string;mimeType:"image/jpeg"|"image/png"|"application/pdf";sha256:string;sizeBytes:number;createdAt:string};
export type ShipmentClaim={id:string;shipmentId:string;claimType:"lost"|"damaged"|"stolen";description:string;requestedAmount:number;eligibleAmount:number;approvedAmount:number|null;status:"submitted"|"under_review"|"approved"|"rejected"|"settlement_pending"|"settled";resolutionNote:string|null;evidence:ShipmentClaimEvidence[];createdAt:string;updatedAt:string};
export type ShipmentOptions={categories:Array<{code:NonNullable<Shipment["itemCategory"]>;name:string;handlingInstructions:string;surcharge:number;maximumWeightKg:number}>;serviceLevels:Array<{code:NonNullable<Shipment["serviceLevel"]>;name:string;transportMultiplier:number;etaMultiplier:number;maximumDistanceKm:number|null}>};

export type AppState = {
  users: User[];
  addresses:UserAddress[];
  paymentMethods:PaymentMethod[];
  supportTickets:SupportTicket[];
  restaurants: Restaurant[];
  drivers: Driver[];
  orders: Order[];
  rides: Ride[];
  shipments: Shipment[];
  tips?: ServiceTip[];
  metrics: {
    activeOrders: number;
    activeRides: number;
    onlineDrivers: number;
    openRestaurants: number;
    openTickets: number;
    avgOrderEta: number;
    avgRideEta: number;
  };
};

export type PaymentMethod={id:string;userId:string;type:"card"|"bank_account"|"wallet"|"cash";label:string;brand:string|null;last4:string|null;expiryMonth:number|null;expiryYear:number|null;isDefault:boolean};
export type AppNotification={id:string;channel:"push"|"email"|"sms"|"in_app";template:string;payload:Record<string,unknown>;status:string;createdAt:string;readAt:string|null};
export type AccountSession={id:string;deviceName:string;createdAt:string;expiresAt:string};
export type NotificationPreference={category:"service_updates"|"promotions"|"support"|"wallet"|"account";pushEnabled:boolean;emailEnabled:boolean;updatedAt:string|null};
export type DietaryPreferences={dietaryLabels:Array<{code:string;name:string}>;avoidedAllergens:Array<{code:string;name:string}>;hideIncompatible:boolean};
export type ReferralSummary={code:string;campaign:{name:string;advocateReward:number;friendReward:number;currency:string}|null;invited:number;rewarded:number;attribution:{status:"pending"|"rewarded"|"rejected";code:string;attributedAt:string;rewardedAt:string|null}|null};
export type RideTrustedContact={id:string;name:string;relationship:"family"|"friend"|"partner"|"coworker"|"other";phone:string;last4:string;active:boolean;createdAt:string};
export type ServiceAttachment={id:string;fileName:string;mimeType:"image/jpeg"|"image/png"|"application/pdf";sizeBytes:number;createdAt:string};
export type ServiceQuickReply={id:string;serviceScope:"all"|"food"|"ride"|"shipment";audience:"customer"|"driver"|"merchant";locale:string;body:string;position:number;active:boolean;updatedAt:string};
export type ServiceMessage={id:string;jobId:string;senderId:string;senderName:string;body:string;createdAt:string;readBy:Array<{userId:string;readAt:string}>;attachments:ServiceAttachment[]};
export type SupportTicket={id:string;userId:string;jobId:string|null;service:string;status:"open"|"waiting_customer"|"waiting_operations"|"resolved"|"closed";title:string;priority:"low"|"medium"|"high"|"urgent";assignedTo:string|null;createdAt:string;updatedAt:string;firstResponseDueAt:string;resolutionDueAt:string;firstRespondedAt:string|null;slaStatus:"on_track"|"first_response_breached"|"resolution_breached"|"met";messages:Array<{id:string;senderId:string|null;body:string;internal:boolean;createdAt:string}>};
export type DriverDocument={id:string;type:"identity"|"driver_license"|"vehicle_registration"|"insurance"|"background_check";mimeType:string;sha256:string;sizeBytes:number;expiresAt:string|null;status:"pending"|"approved"|"rejected"|"expired"|"superseded";rejectionReason:string|null;reviewedAt:string|null;createdAt:string};
export type DriverCompliance={driverId:string;status:"pending"|"in_review"|"approved"|"rejected"|"suspended";submittedAt:string|null;reviewedAt:string|null;rejectionReason:string|null;requiredTypes:DriverDocument["type"][];documents:DriverDocument[]};

export type ServiceTip={id:string;jobId:string;customerId:string;driverId:string;amount:number;createdAt:string};
export type ServiceCancellation={id:string;reason:string;refundAmount:number;fee:number;createdAt:string};

export type ServiceReceipt={id:string;number:string;jobId:string;serviceKind:"ride"|"delivery";serviceSubtype:string|null;subtotal:number;discount:number;deliveryFee:number;serviceFee:number;total:number;currency:string;lineItems:Array<{name:string;quantity:number;unitPrice:number;total:number;extras?:string[]}>;payment:{provider?:string;status:string;amount?:number;capturedAmount?:number;currency:string};issuedAt:string;fiscal:false;documentType:"service_receipt";metadata:{pickup?:string;dropoff?:string;serviceLevel?:string}};

export type DispatchScoreBreakdown={rating:number;distancePenalty:number;loadPenalty:number;freshnessPenalty:number;acceptancePoints:number;responsePoints:number;acceptanceRate:number;averageResponseSeconds:number};
export type DispatchOffer = { id:string;jobId:string;kind:"ride"|"delivery";subtype:string|null;serviceLevel:string;pickup:string;destination:string;fare:number;distanceKm:number;durationMin:number;score:number;scoreBreakdown?:DispatchScoreBreakdown;expiresAt:string;status:"pending" };
