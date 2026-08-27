import pg from "pg";
const { Client } = pg;
const connectionString = process.env.RLS_AUDIT_DATABASE_URL;
if (!connectionString) throw new Error("RLS_AUDIT_DATABASE_URL is required");
const client = new Client({ connectionString, ssl: false });
function assert(condition, label, detail = "") {
  if (!condition) throw new Error(`${label}: ${detail}`);
  console.log(`ok - ${label}`);
}
await client.connect();
let owner;
let customer;
let fixtureTicketId;
let fixtureRatingId;
let fixtureFavorite;
let fixtureDeviceId;
let fixtureOfferId;
let fixturePayoutId;
let fixtureTipId;
let fixtureTipTransactionId;
let fixtureReceiptId;
let fixtureCancellationId;
let fixturePaymentMethodId;
let fixturePreferencePrevious;
let fixtureDriverPreferencePrevious;
let fixtureDriverId;
let fixtureAvailabilitySessionId;
let fixtureJobSessionId;
let fixtureDietaryPreference;
let fixtureRideDestinationId;
let fixtureTrustedContactId;
let fixtureRideVerificationJobId;
let fixtureRideVerificationCreated = false;
let fixtureServiceMessageId;
try {
  const role = (
    await client.query(
      `SELECT current_user,r.rolsuper,r.rolbypassrls,(SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='users') tableowner FROM pg_roles r WHERE r.rolname=current_user`,
    )
  ).rows[0];
  assert(
    role.current_user === "flash_rls_audit" &&
      !role.rolsuper &&
      !role.rolbypassrls &&
      role.tableowner !== role.current_user,
    "audit role is non-owner without RLS bypass",
    JSON.stringify(role),
  );
  const auditPrivileges = (
    await client.query(
      `SELECT has_table_privilege(current_user,'audit_events','SELECT') can_read,has_table_privilege(current_user,'audit_events','INSERT') can_insert,has_table_privilege(current_user,'audit_events','UPDATE') can_update,has_table_privilege(current_user,'audit_events','DELETE') can_delete,has_table_privilege(current_user,'audit_events','TRUNCATE') can_truncate`,
    )
  ).rows[0];
  assert(
    auditPrivileges.can_read &&
      !auditPrivileges.can_insert &&
      !auditPrivileges.can_update &&
      !auditPrivileges.can_delete &&
      !auditPrivileges.can_truncate,
    "audit credentials are read-only on append-only history",
  );
  const auditChainInvalid = Number(
      (await client.query("SELECT app.audit_chain_invalid_count() invalid")).rows[0].invalid,
    ),
    auditVerifierSecurity = (
      await client.query(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE oid='app.audit_chain_invalid_count()'::regprocedure",
      )
    ).rows[0];
  assert(
    auditChainInvalid === 0 &&
      auditVerifierSecurity.prosecdef &&
      auditVerifierSecurity.proconfig?.some((value) => value.startsWith("search_path=")),
    "read-only auditor verifies an intact hash chain through a fixed-search-path function",
  );
  const ids = await client.query("SELECT public_id,id FROM users");
  let passwordHashDenied = false;
  try {
    await client.query("SELECT password_hash FROM users LIMIT 1");
  } catch (error) {
    passwordHashDenied = error.code === "42501";
  }
  assert(passwordHashDenied, "restricted audit role cannot read password hashes");
  // RLS intentionally returns no rows before a user context exists.
  assert(ids.rowCount === 0, "RLS denies users without context");
  const visiblePricing = await client.query(
    "SELECT service,version FROM pricing_plans WHERE active",
  );
  let pricingWriteDenied = false;
  try {
    await client.query("UPDATE pricing_plans SET version=version WHERE active");
  } catch (error) {
    pricingWriteDenied = error.code === "42501";
  }
  assert(
    ["food", "ride", "shipment"].every((service) =>
      visiblePricing.rows.some((row) => row.service === service),
    ) && pricingWriteDenied,
    "restricted audit role reads public pricing but cannot mutate it",
  );
  const quickReplyPosture = await client.query(
    "SELECT count(*)::int count FROM service_chat_quick_replies WHERE active",
  );
  let quickReplyWriteDenied = false;
  try {
    await client.query("UPDATE service_chat_quick_replies SET active=false");
  } catch (error) {
    quickReplyWriteDenied = error.code === "42501";
  }
  assert(
    quickReplyPosture.rows[0].count >= 11 && quickReplyWriteDenied,
    "restricted auditor inspects active chat configuration but cannot alter customer messaging",
  );
  const pricingApprovalPosture = await client.query(
    "SELECT count(*)::int count FROM pricing_change_requests",
  );
  let pricingApprovalWriteDenied = false;
  try {
    await client.query("UPDATE pricing_change_requests SET status=status");
  } catch (error) {
    pricingApprovalWriteDenied = error.code === "42501";
  }
  assert(
    pricingApprovalPosture.rows[0].count === 0 && pricingApprovalWriteDenied,
    "pricing approval queue requires admin context and remains immutable to audit credentials",
  );
  const shipmentConfiguration = await client.query(
    "SELECT (SELECT count(*) FROM shipment_item_categories WHERE active)::int categories,(SELECT count(*) FROM shipment_service_levels WHERE active)::int levels",
  );
  let shipmentConfigurationWriteDenied = false;
  try {
    await client.query(
      "UPDATE shipment_service_levels SET transport_multiplier=transport_multiplier",
    );
  } catch (error) {
    shipmentConfigurationWriteDenied = error.code === "42501";
  }
  assert(
    shipmentConfiguration.rows[0].categories === 4 &&
      shipmentConfiguration.rows[0].levels === 4 &&
      shipmentConfigurationWriteDenied,
    "restricted audit role reads shipment SLA posture but cannot alter customer pricing",
  );

  // `shipment_details` guarda el nombre y el telefono de una persona que ni
  // siquiera es usuaria de la plataforma, mas el hash del PIN de entrega. Hasta
  // la migracion 113 no tenia RLS, asi que cualquier rol con un grant leia los
  // datos de contacto de todos los destinatarios del sistema.
  //
  // El grant al rol auditor se agrego en esa misma migracion **para que esta
  // prueba signifique algo**: sin el, ver cero filas demostraria que falta el
  // permiso, no que la politica funciona. Con el permiso puesto, cero filas solo
  // lo puede explicar RLS.
  const recipientRows = await client.query("SELECT count(*)::int count FROM shipment_details");
  let recipientWriteDenied = false;
  try {
    await client.query("UPDATE shipment_details SET delivery_notes=delivery_notes");
  } catch (error) {
    recipientWriteDenied = error.code === "42501";
  }
  assert(
    recipientRows.rows[0].count === 0 && recipientWriteDenied,
    "audit credentials without user context see no shipment recipient data at all",
  );
  const visibleModifiers = await client.query(
    "SELECT count(*)::int count FROM catalog_modifiers WHERE available",
  );
  let modifierWriteDenied = false;
  try {
    await client.query("UPDATE catalog_modifiers SET price_cents=price_cents");
  } catch (error) {
    modifierWriteDenied = error.code === "42501";
  }
  assert(
    visibleModifiers.rows[0].count > 0 && modifierWriteDenied,
    "restricted audit role can inspect catalog modifiers but cannot change customer pricing",
  );
  const dietaryPosture = await client.query(
    "SELECT (SELECT count(*) FROM dietary_labels WHERE active)::int diets,(SELECT count(*) FROM allergens WHERE active)::int allergens,(SELECT count(*) FROM catalog_item_allergens)::int declarations",
  );
  let dietaryWriteDenied = false;
  try {
    await client.query("DELETE FROM catalog_item_allergens");
  } catch (error) {
    dietaryWriteDenied = error.code === "42501";
  }
  assert(
    dietaryPosture.rows[0].diets >= 5 &&
      dietaryPosture.rows[0].allergens >= 9 &&
      dietaryPosture.rows[0].declarations > 0 &&
      dietaryWriteDenied,
    "restricted audit role inspects dietary posture but cannot alter merchant declarations",
  );
  const scheduleFunctionAcl = (
    await client.query(
      `SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid='app.branch_is_scheduled_open(uuid,timestamptz)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') public_denied,has_function_privilege(current_user,'app.branch_is_scheduled_open(uuid,timestamptz)','EXECUTE') audit_allowed`,
    )
  ).rows[0];
  assert(
    scheduleFunctionAcl.public_denied && scheduleFunctionAcl.audit_allowed,
    "branch schedule evaluator denies PUBLIC and grants only explicit operational roles",
  );
  const mfaPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'user_mfa','enabled','SELECT') metadata,has_column_privilege(current_user,'user_mfa','secret_ciphertext','SELECT') secret,has_column_privilege(current_user,'user_mfa','recovery_code_hashes','SELECT') recovery`,
    )
  ).rows[0];
  assert(
    mfaPrivileges.metadata && !mfaPrivileges.secret && !mfaPrivileges.recovery,
    "audit role can inspect MFA posture but never secrets or recovery hashes",
  );
  const sessionPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'refresh_sessions','created_at','SELECT') metadata,has_column_privilege(current_user,'refresh_sessions','token_hash','SELECT') token`,
    )
  ).rows[0];
  assert(
    sessionPrivileges.metadata && !sessionPrivileges.token,
    "audit role can inspect session posture but never refresh-token hashes",
  );
  const paymentPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'payment_methods','last4','SELECT') metadata,has_column_privilege(current_user,'payment_methods','provider_payment_method_id','SELECT') provider_token`,
    )
  ).rows[0];
  assert(
    paymentPrivileges.metadata && !paymentPrivileges.provider_token,
    "audit role can inspect masked payment metadata but never provider tokens",
  );
  const payoutPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'payouts','review_decision','SELECT') review,has_column_privilege(current_user,'payouts','metadata','SELECT') metadata,has_column_privilege(current_user,'payouts','idempotency_key','SELECT') idempotency`,
    )
  ).rows[0];
  assert(
    payoutPrivileges.review && !payoutPrivileges.metadata && !payoutPrivileges.idempotency,
    "audit role inspects payout approvals without internal metadata or idempotency keys",
  );
  const tipAdjustmentPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'service_tip_adjustments','status','SELECT') outcome,has_column_privilege(current_user,'service_tip_adjustments','reason','SELECT') reason,has_column_privilege(current_user,'service_tip_adjustments','idempotency_key','SELECT') idempotency,has_table_privilege(current_user,'service_tip_adjustments','UPDATE') can_update`,
    )
  ).rows[0];
  assert(
    tipAdjustmentPrivileges.outcome &&
      tipAdjustmentPrivileges.reason &&
      !tipAdjustmentPrivileges.idempotency &&
      !tipAdjustmentPrivileges.can_update,
    "audit role inspects dual-control tip corrections without idempotency secrets or write access",
  );
  const supportRoutingPrivileges = (
    await client.query(
      `SELECT has_table_privilege(current_user,'support_agent_profiles','SELECT') profiles,has_table_privilege(current_user,'support_ticket_assignments','SELECT') assignments,has_table_privilege(current_user,'support_escalation_events','SELECT') escalations,has_table_privilege(current_user,'support_agent_profiles','UPDATE') can_update`,
    )
  ).rows[0];
  assert(
    supportRoutingPrivileges.profiles &&
      supportRoutingPrivileges.assignments &&
      supportRoutingPrivileges.escalations &&
      !supportRoutingPrivileges.can_update,
    "audit role inspects support routing and escalation history without operational write access",
  );
  const notificationFailurePrivileges = (
    await client.query(
      `SELECT has_table_privilege(current_user,'notification_dead_letters','SELECT') dead_letters,has_table_privilege(current_user,'notification_dead_letters','UPDATE') can_update,has_column_privilege(current_user,'user_devices','invalid_reason','SELECT') invalidation,has_column_privilege(current_user,'user_devices','push_token_ciphertext','SELECT') ciphertext,has_column_privilege(current_user,'user_devices','push_token_hash','SELECT') token_hash,has_column_privilege(current_user,'user_devices','device_fingerprint_hash','SELECT') fingerprint`,
    )
  ).rows[0];
  assert(
    notificationFailurePrivileges.dead_letters &&
      notificationFailurePrivileges.invalidation &&
      !notificationFailurePrivileges.can_update &&
      !notificationFailurePrivileges.ciphertext &&
      !notificationFailurePrivileges.token_hash &&
      !notificationFailurePrivileges.fingerprint,
    "audit role inspects notification failures and invalidations without device token or fingerprint material",
  );
  const documentPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'driver_documents','content_sha256','SELECT') metadata,has_column_privilege(current_user,'driver_documents','content_ciphertext','SELECT') content`,
    )
  ).rows[0];
  assert(
    documentPrivileges.metadata && !documentPrivileges.content,
    "audit role can inspect KYC posture but never encrypted document content",
  );
  const vehiclePrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'vehicles','status','SELECT') posture,has_column_privilege(current_user,'vehicles','plate','SELECT') plate,has_column_privilege(current_user,'vehicles','model','SELECT') model,has_column_privilege(current_user,'vehicles','color','SELECT') color,has_table_privilege(current_user,'vehicles','UPDATE') can_update`,
    )
  ).rows[0];
  assert(
    vehiclePrivileges.posture &&
      !vehiclePrivileges.plate &&
      !vehiclePrivileges.model &&
      !vehiclePrivileges.color &&
      !vehiclePrivileges.can_update,
    "audit role inspects vehicle approval posture without identity attributes or write access",
  );
  const driverPreferencePrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'driver_preferences','navigation_provider','SELECT') can_read,has_table_privilege(current_user,'driver_preferences','UPDATE') can_update`,
    )
  ).rows[0];
  assert(
    driverPreferencePrivileges.can_read && !driverPreferencePrivileges.can_update,
    "audit role inspects navigator posture but cannot change driver preference",
  );
  const driverTimePrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'driver_availability_sessions','started_at','SELECT') availability,has_column_privilege(current_user,'driver_job_sessions','ended_at','SELECT') active_time,has_table_privilege(current_user,'driver_availability_sessions','UPDATE') can_update_availability,has_table_privilege(current_user,'driver_job_sessions','UPDATE') can_update_active`,
    )
  ).rows[0];
  assert(
    driverTimePrivileges.availability &&
      driverTimePrivileges.active_time &&
      !driverTimePrivileges.can_update_availability &&
      !driverTimePrivileges.can_update_active,
    "audit role inspects driver time provenance without changing operational intervals",
  );
  const deliveryEvidencePrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'shipment_delivery_evidence','content_sha256','SELECT') metadata,has_column_privilege(current_user,'shipment_delivery_evidence','content_ciphertext','SELECT') content,has_column_privilege(current_user,'shipment_delivery_evidence','signer_name','SELECT') signer_identity,has_column_privilege(current_user,'shipment_delivery_evidence','consent_version','SELECT') consent_posture`,
    )
  ).rows[0];
  assert(
    deliveryEvidencePrivileges.metadata &&
      deliveryEvidencePrivileges.consent_posture &&
      !deliveryEvidencePrivileges.content &&
      !deliveryEvidencePrivileges.signer_identity,
    "audit role can inspect delivery-proof integrity and consent posture but never encrypted evidence or signer identity",
  );
  const trackingPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'ride_tracking_links','expires_at','SELECT') metadata,has_column_privilege(current_user,'ride_tracking_links','token_hash','SELECT') token`,
    )
  ).rows[0];
  assert(
    trackingPrivileges.metadata && !trackingPrivileges.token,
    "audit role can inspect tracking-link posture but never bearer-token digests",
  );
  const trustedContactPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'ride_trusted_contacts','phone_last4','SELECT') metadata,has_column_privilege(current_user,'ride_trusted_contacts','phone_ciphertext','SELECT') phone,has_column_privilege(current_user,'ride_trusted_contacts','name','SELECT') identity`,
    )
  ).rows[0];
  assert(
    trustedContactPrivileges.metadata &&
      !trustedContactPrivileges.phone &&
      !trustedContactPrivileges.identity,
    "audit role can inspect trusted-contact posture but never identity or encrypted phone data",
  );
  const ridePinPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'ride_pickup_verifications','verified_at','SELECT') metadata,has_column_privilege(current_user,'ride_pickup_verifications','pin_hash','SELECT') secret`,
    )
  ).rows[0];
  assert(
    ridePinPrivileges.metadata && !ridePinPrivileges.secret,
    "audit role can inspect ride pickup-verification posture but never PIN hashes",
  );
  const serviceMessagePrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'service_messages','created_at','SELECT') metadata,has_column_privilege(current_user,'service_messages','body_ciphertext','SELECT') content,has_column_privilege(current_user,'service_messages','body_sha256','SELECT') digest,has_column_privilege(current_user,'service_message_reads','read_at','SELECT') receipt_metadata`,
    )
  ).rows[0];
  assert(
    serviceMessagePrivileges.metadata &&
      serviceMessagePrivileges.receipt_metadata &&
      !serviceMessagePrivileges.content &&
      !serviceMessagePrivileges.digest,
    "audit role can inspect service-chat and receipt posture but never encrypted content or message digests",
  );
  const serviceAttachmentPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'service_message_attachments','mime_type','SELECT') metadata,has_column_privilege(current_user,'service_message_attachments','content_ciphertext','SELECT') content,has_column_privilege(current_user,'service_message_attachments','content_sha256','SELECT') digest`,
    )
  ).rows[0];
  assert(
    serviceAttachmentPrivileges.metadata &&
      !serviceAttachmentPrivileges.content &&
      !serviceAttachmentPrivileges.digest,
    "audit role can inspect attachment posture but never encrypted bytes or content digests",
  );
  const shipmentClaimPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'shipment_protection_claims','status','SELECT') metadata,has_column_privilege(current_user,'shipment_protection_claims','description','SELECT') narrative`,
    )
  ).rows[0];
  assert(
    shipmentClaimPrivileges.metadata && !shipmentClaimPrivileges.narrative,
    "audit role inspects shipment-claim posture but never customer narrative",
  );
  const shipmentClaimEvidencePrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'shipment_claim_evidence','mime_type','SELECT') metadata,has_column_privilege(current_user,'shipment_claim_evidence','content_ciphertext','SELECT') ciphertext,has_column_privilege(current_user,'shipment_claim_evidence','content_sha256','SELECT') digest`,
    )
  ).rows[0];
  assert(
    shipmentClaimEvidencePrivileges.metadata &&
      !shipmentClaimEvidencePrivileges.ciphertext &&
      !shipmentClaimEvidencePrivileges.digest,
    "audit role inspects claim-evidence posture but never encrypted bytes or content digests",
  );
  const reconciliationPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'payment_reconciliation_cases','status','SELECT') metadata,has_column_privilege(current_user,'payment_reconciliation_cases','details','SELECT') details`,
    )
  ).rows[0];
  assert(
    reconciliationPrivileges.metadata && !reconciliationPrivileges.details,
    "audit role inspects reconciliation posture but never provider diagnostic details",
  );
  const riskPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'transaction_risk_assessments','decision','SELECT') outcome,has_column_privilege(current_user,'transaction_risk_assessments','rules','SELECT') rules`,
    )
  ).rows[0];
  assert(
    riskPrivileges.outcome && !riskPrivileges.rules,
    "audit role inspects fraud outcomes but cannot read rule signals",
  );
  const recoveryPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'password_recovery_tokens','expires_at','SELECT') metadata,has_column_privilege(current_user,'password_recovery_tokens','token_hash','SELECT') token`,
    )
  ).rows[0];
  assert(
    recoveryPrivileges.metadata && !recoveryPrivileges.token,
    "audit role can inspect recovery posture but never password-reset digests",
  );
  const emailOutboxPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'notifications','status','SELECT') metadata,has_column_privilege(current_user,'notifications','sensitive_payload_ciphertext','SELECT') secret`,
    )
  ).rows[0];
  assert(
    emailOutboxPrivileges.metadata && !emailOutboxPrivileges.secret,
    "audit role can inspect email delivery posture but never encrypted recovery payloads",
  );
  const verificationPrivileges = (
    await client.query(
      `SELECT has_column_privilege(current_user,'email_verification_challenges','expires_at','SELECT') metadata,has_column_privilege(current_user,'email_verification_challenges','code_hash','SELECT') secret`,
    )
  ).rows[0];
  assert(
    verificationPrivileges.metadata && !verificationPrivileges.secret,
    "audit role can inspect email-verification posture but never OTP hashes",
  );
  owner = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    ssl: false,
  });
  await owner.connect();
  const known = await owner.query(
    "SELECT public_id,id FROM users WHERE public_id IN('usr_customer','usr_admin','usr_driver','usr_merchant') ORDER BY public_id",
  );
  customer = known.rows.find((row) => row.public_id === "usr_customer");
  const admin = known.rows.find((row) => row.public_id === "usr_admin"),
    driverUser = known.rows.find((row) => row.public_id === "usr_driver"),
    merchantUser = known.rows.find((row) => row.public_id === "usr_merchant");
  fixtureTicketId = (
    await owner.query(
      `INSERT INTO support_tickets(public_id,user_id,category,subject) VALUES($1,$2,'account','RLS fixture') RETURNING id`,
      [`TCK-RLS-${Date.now()}`, customer.id],
    )
  ).rows[0].id;
  await owner.query(
    `INSERT INTO support_messages(ticket_id,sender_id,body,internal) VALUES($1,$2,'visible',$3),($1,$2,'internal',$4)`,
    [fixtureTicketId, customer.id, false, true],
  );
  await owner.query(
    `INSERT INTO notifications(public_id,user_id,channel,template,deduplication_key,status) VALUES($1,$2,'in_app','rls_fixture',$3,'sent')`,
    [`NTF-RLS-${Date.now()}`, customer.id, `rls-${Date.now()}`],
  );
  fixtureDeviceId = (
    await owner.query(
      `INSERT INTO user_devices(public_id,user_id,platform,push_token) VALUES($1,$2,'web',$3) RETURNING id`,
      [`DEV-RLS-${Date.now()}`, customer.id, `rls-device-${Date.now()}`],
    )
  ).rows[0].id;
  fixturePaymentMethodId = (
    await owner.query(
      `INSERT INTO payment_methods(user_id,provider,provider_payment_method_id,kind,brand,last4,expiry_month,expiry_year) VALUES($1,'sandbox',$2,'card','visa','4242',12,2099) RETURNING id`,
      [customer.id, `pm_test_rls_${Date.now()}`],
    )
  ).rows[0].id;
  fixturePreferencePrevious =
    (
      await owner.query(
        "SELECT push_enabled,email_enabled FROM user_notification_preferences WHERE user_id=$1 AND category='account'",
        [customer.id],
      )
    ).rows[0] || null;
  await owner.query(
    "INSERT INTO user_notification_preferences(user_id,category,push_enabled,email_enabled) VALUES($1,'account',false,false) ON CONFLICT(user_id,category) DO UPDATE SET push_enabled=false,email_enabled=false",
    [customer.id],
  );
  fixtureDietaryPreference =
    (
      await owner.query(
        "INSERT INTO user_avoided_allergens(user_id,allergen_code) VALUES($1,'sesame') ON CONFLICT DO NOTHING RETURNING user_id,allergen_code",
        [customer.id],
      )
    ).rows[0] || null;
  fixtureRideDestinationId = (
    await owner.query(
      `INSERT INTO ride_destination_history(user_id,address_key,label,formatted_address,location) VALUES($1,$2,'RLS destino','Destino RLS',ST_SetSRID(ST_MakePoint(-58.4,-34.6),4326)::geography) RETURNING id`,
      [customer.id, `rls-${Date.now()}`],
    )
  ).rows[0].id;
  fixtureTrustedContactId = (
    await owner.query(
      `INSERT INTO ride_trusted_contacts(user_id,name,relationship,phone_ciphertext,phone_hash,phone_last4) VALUES($1,'Contacto RLS','family','fixture-envelope',$2,'5678') RETURNING id`,
      [customer.id, "a".repeat(64)],
    )
  ).rows[0].id;
  await owner.query("DELETE FROM job_cancellations WHERE public_id LIKE 'CAN-RLS-INVALID-%'");
  const fixtureJob = (
      await owner.query(
        "SELECT j.id FROM jobs j WHERE j.customer_id=$1 AND NOT EXISTS(SELECT 1 FROM service_tips t WHERE t.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM service_receipts r WHERE r.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM job_cancellations c WHERE c.job_id=j.id) LIMIT 1",
        [customer.id],
      )
    ).rows[0],
    fixtureMerchant = (await owner.query("SELECT id FROM merchants LIMIT 1")).rows[0];
  fixtureServiceMessageId = (
    await owner.query(
      `INSERT INTO service_messages(public_id,job_id,sender_id,body_ciphertext,body_sha256) VALUES($1,$2,$3,'rls-envelope',$4) RETURNING id`,
      [`MSG-RLS-${Date.now()}`, fixtureJob.id, customer.id, "b".repeat(64)],
    )
  ).rows[0].id;
  const rideFixture = (
    await owner.query("SELECT id FROM jobs WHERE customer_id=$1 AND kind='ride' LIMIT 1", [
      customer.id,
    ])
  ).rows[0];
  if (rideFixture) {
    fixtureRideVerificationJobId = rideFixture.id;
    fixtureRideVerificationCreated = Boolean(
      (
        await owner.query(
          "INSERT INTO ride_pickup_verifications(job_id,pin_hash) VALUES($1,'rls-fixture') ON CONFLICT(job_id) DO NOTHING RETURNING job_id",
          [rideFixture.id],
        )
      ).rows[0],
    );
  }
  const ownedMerchant = (
    await owner.query("SELECT id FROM merchants WHERE owner_id=$1 LIMIT 1", [merchantUser.id])
  ).rows[0];
  fixturePayoutId = (
    await owner.query(
      `INSERT INTO payouts(public_id,payee_type,payee_id,provider,amount_cents,status,period_start,period_end) VALUES($1,'merchant',$2,'rls_fixture',100,'pending',now()-interval '1 day',now()) RETURNING id`,
      [`PAY-RLS-${Date.now()}`, ownedMerchant.id],
    )
  ).rows[0].id;
  const driver = (await owner.query("SELECT id FROM drivers WHERE user_id=$1", [driverUser.id]))
    .rows[0];
  fixtureDriverId = driver.id;
  fixtureDriverPreferencePrevious =
    (
      await owner.query("SELECT navigation_provider FROM driver_preferences WHERE driver_id=$1", [
        driver.id,
      ])
    ).rows[0] || null;
  await owner.query(
    "INSERT INTO driver_preferences(driver_id,navigation_provider) VALUES($1,'system') ON CONFLICT(driver_id) DO UPDATE SET navigation_provider='system'",
    [driver.id],
  );
  fixtureAvailabilitySessionId = (
    await owner.query(
      "INSERT INTO driver_availability_sessions(driver_id,service_mode,started_at,ended_at,start_reason,end_reason) VALUES($1,'delivery',now()-interval '2 minutes',now()-interval '1 minute','driver_online','offline') RETURNING id",
      [driver.id],
    )
  ).rows[0].id;
  fixtureJobSessionId = (
    await owner.query(
      "INSERT INTO driver_job_sessions(driver_id,job_id,service_mode,started_at,ended_at,start_reason,end_reason) VALUES($1,$2,'delivery',now()-interval '2 minutes',now()-interval '1 minute','offer_accepted','completed') RETURNING id",
      [driver.id, fixtureJob.id],
    )
  ).rows[0].id;
  fixtureTipTransactionId = (
    await owner.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description) VALUES($1,'tip',$2,'RLS tip fixture') RETURNING id`,
      [`tip-rls-${Date.now()}`, customer.id],
    )
  ).rows[0].id;
  fixtureTipId = (
    await owner.query(
      `INSERT INTO service_tips(public_id,job_id,customer_id,driver_id,amount_cents,idempotency_key,ledger_transaction_id) VALUES($1,$2,$3,$4,10000,$5,$6) RETURNING id`,
      [
        `TIP-RLS-${Date.now()}`,
        fixtureJob.id,
        customer.id,
        driver.id,
        `rls-${Date.now()}`,
        fixtureTipTransactionId,
      ],
    )
  ).rows[0].id;
  fixtureReceiptId = (
    await owner.query(
      `INSERT INTO service_receipts(public_id,receipt_number,job_id,customer_id,service_kind,subtotal_cents,total_cents) SELECT $1,$2,j.id,j.customer_id,j.kind,j.quoted_amount_cents,j.quoted_amount_cents FROM jobs j WHERE j.id=$3 RETURNING id`,
      [`RCT-RLS-${Date.now()}`, `FL-RLS-${Date.now()}`, fixtureJob.id],
    )
  ).rows[0].id;
  let invalidCancellationRejected = false;
  try {
    await owner.query(
      `INSERT INTO job_cancellations(public_id,job_id,actor_id,reason_code) VALUES($1,$2,$3,'other')`,
      [`CAN-RLS-INVALID-${Date.now()}`, fixtureJob.id, customer.id],
    );
  } catch (error) {
    invalidCancellationRejected = error.code === "23514";
  }
  assert(
    invalidCancellationRejected,
    "database rejects free-form cancellation without required detail",
  );
  fixtureCancellationId = (
    await owner.query(
      `INSERT INTO job_cancellations(public_id,job_id,actor_id,reason_code) VALUES($1,$2,$3,'changed_mind') RETURNING id`,
      [`CAN-RLS-${Date.now()}`, fixtureJob.id, customer.id],
    )
  ).rows[0].id;
  fixtureOfferId = (
    await owner.query(
      `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at) VALUES($1,$2,$3,99,now()+interval '5 minutes') ON CONFLICT(job_id,driver_id) DO UPDATE SET status='pending',expires_at=excluded.expires_at RETURNING id`,
      [`OFR-RLS-${Date.now()}`, fixtureJob.id, driver.id],
    )
  ).rows[0].id;
  fixtureRatingId = (
    await owner.query(
      `INSERT INTO ratings(public_id,job_id,author_id,subject_type,subject_id,score,comment) VALUES($1,$2,$3,'customer',$3,5,'rls fixture') RETURNING id`,
      [`RATE-RLS-${Date.now()}`, fixtureJob.id, customer.id],
    )
  ).rows[0].id;
  const favoriteRow = (
    await owner.query(
      "INSERT INTO favorites(user_id,merchant_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id,merchant_id",
      [customer.id, fixtureMerchant.id],
    )
  ).rows[0];
  fixtureFavorite = favoriteRow
    ? { userId: favoriteRow.user_id, merchantId: favoriteRow.merchant_id }
    : null;
  await client.query(
    "SELECT set_config('app.user_id',$1,false),set_config('app.roles','customer',false)",
    [customer.id],
  );
  const customerUsers = await client.query("SELECT public_id FROM users");
  assert(
    customerUsers.rowCount === 1 && customerUsers.rows[0].public_id === "usr_customer",
    "RLS exposes only current customer row",
  );
  const customerAddresses = await client.query("SELECT DISTINCT user_id FROM addresses");
  assert(
    customerAddresses.rows.every((row) => row.user_id === customer.id),
    "RLS exposes only the current customer's saved addresses",
  );

  // La otra mitad de la politica de `shipment_details`. Sin esto la prueba de
  // arriba solo demostraria que la tabla esta cerrada, no que discrimina: una
  // politica que niega a todo el mundo pasa el test negativo y rompe el
  // producto.
  const shipmentDetailsVisibles = await client.query(
    `SELECT count(*)::int count FROM shipment_details d
     JOIN jobs j ON j.id = d.job_id
     WHERE j.customer_id <> $1`,
    [customer.id],
  );
  assert(
    shipmentDetailsVisibles.rows[0].count === 0,
    "RLS hides shipment recipients belonging to other customers",
  );
  assert(
    (
      await client.query("SELECT count(last4)::int count FROM payment_methods WHERE id=$1", [
        fixturePaymentMethodId,
      ])
    ).rows[0].count === 1,
    "RLS exposes masked payment metadata to its owner",
  );
  assert(
    (
      await client.query(
        "SELECT count(*)::int count FROM user_notification_preferences WHERE category='account'",
      )
    ).rows[0].count === 1,
    "RLS exposes notification preferences to their owner",
  );
  assert(
    (
      await client.query(
        "SELECT count(*)::int count FROM user_avoided_allergens WHERE allergen_code='sesame'",
      )
    ).rows[0].count === 1,
    "RLS exposes dietary preferences only to their owner",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM ride_destination_history WHERE id=$1", [
        fixtureRideDestinationId,
      ])
    ).rows[0].count === 1,
    "RLS exposes geocoded ride recents only to their owner",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM ride_trusted_contacts WHERE id=$1", [
        fixtureTrustedContactId,
      ])
    ).rows[0].count === 1,
    "RLS exposes trusted-contact metadata only to its owner",
  );
  if (fixtureRideVerificationJobId)
    assert(
      (
        await client.query(
          "SELECT count(*)::int count FROM ride_pickup_verifications WHERE job_id=$1",
          [fixtureRideVerificationJobId],
        )
      ).rows[0].count === 1,
      "RLS exposes ride PIN posture only to a participant",
    );
  const customerSessions = await client.query("SELECT DISTINCT user_id FROM refresh_sessions");
  assert(
    customerSessions.rows.every((row) => row.user_id === customer.id),
    "RLS exposes session metadata only for the current customer",
  );
  const customerJobs = await client.query("SELECT count(*)::int count FROM jobs");
  assert(customerJobs.rows[0].count >= 1, "RLS exposes customer-owned jobs");
  const customerTickets = await client.query(
    "SELECT count(*)::int count FROM support_tickets WHERE id=$1",
    [fixtureTicketId],
  );
  const customerMessages = await client.query(
    "SELECT body FROM support_messages WHERE ticket_id=$1 ORDER BY body",
    [fixtureTicketId],
  );
  const customerNotifications = await client.query(
    "SELECT count(*)::int count FROM notifications WHERE template='rls_fixture'",
  );
  assert(
    customerTickets.rows[0].count === 1 && customerNotifications.rows[0].count === 1,
    "RLS exposes customer support and notifications",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM user_devices WHERE id=$1", [
        fixtureDeviceId,
      ])
    ).rows[0].count === 1,
    "RLS exposes the current customer's devices",
  );
  assert(
    customerMessages.rowCount === 1 && customerMessages.rows[0].body === "visible",
    "RLS hides internal support notes from customer",
  );
  const customerRatings = await client.query(
      "SELECT count(*)::int count FROM ratings WHERE id=$1",
      [fixtureRatingId],
    ),
    customerFavorites = await client.query("SELECT count(*)::int count FROM favorites");
  assert(
    customerRatings.rows[0].count === 1 && customerFavorites.rows[0].count >= 1,
    "RLS exposes customer ratings and favorites",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM dispatch_offers WHERE id=$1", [
        fixtureOfferId,
      ])
    ).rows[0].count === 0,
    "RLS hides dispatch offers from customers",
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM payouts WHERE id=$1", [fixturePayoutId]))
      .rows[0].count === 0,
    "RLS hides merchant payouts from customers",
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM service_tips WHERE id=$1", [fixtureTipId]))
      .rows[0].count === 1,
    "RLS exposes tip to its customer",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM service_receipts WHERE id=$1", [
        fixtureReceiptId,
      ])
    ).rows[0].count === 1,
    "RLS exposes receipt to its customer",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM job_cancellations WHERE id=$1", [
        fixtureCancellationId,
      ])
    ).rows[0].count === 1,
    "RLS exposes cancellation outcome to its customer",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM service_messages WHERE id=$1", [
        fixtureServiceMessageId,
      ])
    ).rows[0].count === 1,
    "RLS exposes service-chat metadata only to a participant",
  );
  await client.query(
    "SELECT set_config('app.user_id',$1,false),set_config('app.roles','merchant',false)",
    [merchantUser.id],
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM payouts WHERE id=$1", [fixturePayoutId]))
      .rows[0].count === 1,
    "RLS exposes payouts to the owning merchant",
  );
  await client.query(
    "SELECT set_config('app.user_id',$1,false),set_config('app.roles','driver',false)",
    [driverUser.id],
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM dispatch_offers WHERE id=$1", [
        fixtureOfferId,
      ])
    ).rows[0].count === 1,
    "RLS exposes only the driver's dispatch offers",
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM service_tips WHERE id=$1", [fixtureTipId]))
      .rows[0].count === 1,
    "RLS exposes received tip to its driver",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM service_receipts WHERE id=$1", [
        fixtureReceiptId,
      ])
    ).rows[0].count === 0,
    "RLS hides the customer receipt from driver",
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM driver_compliance")).rows[0].count === 1,
    "RLS exposes only the driver's own compliance posture",
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM driver_preferences")).rows[0].count === 1,
    "RLS exposes only the driver's own navigation preference",
  );
  assert(
    (
      await client.query(
        "SELECT count(*)::int count FROM driver_availability_sessions WHERE id=$1",
        [fixtureAvailabilitySessionId],
      )
    ).rows[0].count === 1 &&
      (
        await client.query("SELECT count(*)::int count FROM driver_job_sessions WHERE id=$1", [
          fixtureJobSessionId,
        ])
      ).rows[0].count === 1,
    "RLS exposes the driver's own online and active-time provenance",
  );
  await client.query(
    "SELECT set_config('app.user_id',$1,false),set_config('app.roles','customer',false)",
    [admin.id],
  );
  const otherJobs = await client.query("SELECT count(*)::int count FROM jobs");
  assert(otherJobs.rows[0].count === 0, "RLS hides another customer's jobs");
  assert(
    (await client.query("SELECT count(*)::int count FROM addresses")).rows[0].count === 0,
    "RLS hides another customer's saved addresses",
  );
  assert(
    (
      await client.query("SELECT count(last4)::int count FROM payment_methods WHERE id=$1", [
        fixturePaymentMethodId,
      ])
    ).rows[0].count === 0,
    "RLS hides another customer's payment methods",
  );
  assert(
    (
      await client.query(
        "SELECT count(*)::int count FROM user_notification_preferences WHERE category='account'",
      )
    ).rows[0].count === 0,
    "RLS hides another customer's notification preferences",
  );
  assert(
    (
      await client.query(
        "SELECT count(*)::int count FROM user_avoided_allergens WHERE allergen_code='sesame'",
      )
    ).rows[0].count === 0,
    "RLS hides another customer's dietary preferences",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM ride_destination_history WHERE id=$1", [
        fixtureRideDestinationId,
      ])
    ).rows[0].count === 0,
    "RLS hides another customer's ride recents",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM ride_trusted_contacts WHERE id=$1", [
        fixtureTrustedContactId,
      ])
    ).rows[0].count === 0,
    "RLS hides another customer's trusted contacts",
  );
  if (fixtureRideVerificationJobId)
    assert(
      (
        await client.query(
          "SELECT count(*)::int count FROM ride_pickup_verifications WHERE job_id=$1",
          [fixtureRideVerificationJobId],
        )
      ).rows[0].count === 0,
      "RLS hides another customer's ride PIN posture",
    );
  const otherTickets = await client.query(
    "SELECT count(*)::int count FROM support_tickets WHERE id=$1",
    [fixtureTicketId],
  );
  const otherNotifications = await client.query(
    "SELECT count(*)::int count FROM notifications WHERE template='rls_fixture'",
  );
  assert(
    otherTickets.rows[0].count === 0 && otherNotifications.rows[0].count === 0,
    "RLS hides another customer's support and notifications",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM user_devices WHERE id=$1", [
        fixtureDeviceId,
      ])
    ).rows[0].count === 0,
    "RLS hides another customer's devices",
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM driver_preferences")).rows[0].count === 0,
    "RLS hides driver navigation preference from unrelated users",
  );
  assert(
    (
      await client.query(
        "SELECT count(*)::int count FROM driver_availability_sessions WHERE id=$1",
        [fixtureAvailabilitySessionId],
      )
    ).rows[0].count === 0 &&
      (
        await client.query("SELECT count(*)::int count FROM driver_job_sessions WHERE id=$1", [
          fixtureJobSessionId,
        ])
      ).rows[0].count === 0,
    "RLS hides driver work intervals from unrelated users",
  );
  const otherRatings = await client.query("SELECT count(*)::int count FROM ratings WHERE id=$1", [
      fixtureRatingId,
    ]),
    otherFavorites = await client.query("SELECT count(*)::int count FROM favorites");
  assert(
    otherRatings.rows[0].count === 0 && otherFavorites.rows[0].count === 0,
    "RLS hides another customer's ratings and favorites",
  );
  assert(
    (await client.query("SELECT count(*)::int count FROM service_tips WHERE id=$1", [fixtureTipId]))
      .rows[0].count === 0,
    "RLS hides another customer's tip",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM service_receipts WHERE id=$1", [
        fixtureReceiptId,
      ])
    ).rows[0].count === 0,
    "RLS hides another customer's receipt",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM job_cancellations WHERE id=$1", [
        fixtureCancellationId,
      ])
    ).rows[0].count === 0,
    "RLS hides another customer's cancellation",
  );
  assert(
    (
      await client.query("SELECT count(*)::int count FROM service_messages WHERE id=$1", [
        fixtureServiceMessageId,
      ])
    ).rows[0].count === 0,
    "RLS hides another customer's service chat",
  );
} finally {
  if (owner && fixtureDietaryPreference)
    await owner.query("DELETE FROM user_avoided_allergens WHERE user_id=$1 AND allergen_code=$2", [
      fixtureDietaryPreference.user_id,
      fixtureDietaryPreference.allergen_code,
    ]);
  if (owner && fixtureRideDestinationId)
    await owner.query("DELETE FROM ride_destination_history WHERE id=$1", [
      fixtureRideDestinationId,
    ]);
  if (owner && fixtureTrustedContactId)
    await owner.query("DELETE FROM ride_trusted_contacts WHERE id=$1", [fixtureTrustedContactId]);
  if (owner && fixtureRideVerificationCreated && fixtureRideVerificationJobId)
    await owner.query("DELETE FROM ride_pickup_verifications WHERE job_id=$1", [
      fixtureRideVerificationJobId,
    ]);
  if (owner && customer) {
    if (fixturePreferencePrevious)
      await owner.query(
        "UPDATE user_notification_preferences SET push_enabled=$2,email_enabled=$3 WHERE user_id=$1 AND category='account'",
        [
          customer.id,
          fixturePreferencePrevious.push_enabled,
          fixturePreferencePrevious.email_enabled,
        ],
      );
    else
      await owner.query(
        "DELETE FROM user_notification_preferences WHERE user_id=$1 AND category='account'",
        [customer.id],
      );
  }
  if (owner && fixturePaymentMethodId)
    await owner.query("DELETE FROM payment_methods WHERE id=$1", [fixturePaymentMethodId]);
  if (owner && fixtureAvailabilitySessionId)
    await owner.query("DELETE FROM driver_availability_sessions WHERE id=$1", [
      fixtureAvailabilitySessionId,
    ]);
  if (owner && fixtureJobSessionId)
    await owner.query("DELETE FROM driver_job_sessions WHERE id=$1", [fixtureJobSessionId]);
  if (owner && fixtureDriverId) {
    if (fixtureDriverPreferencePrevious)
      await owner.query(
        "UPDATE driver_preferences SET navigation_provider=$2,updated_at=now() WHERE driver_id=$1",
        [fixtureDriverId, fixtureDriverPreferencePrevious.navigation_provider],
      );
    else await owner.query("DELETE FROM driver_preferences WHERE driver_id=$1", [fixtureDriverId]);
  }
  if (owner) {
    if (fixtureServiceMessageId)
      await owner.query("DELETE FROM service_messages WHERE id=$1", [fixtureServiceMessageId]);
    if (fixtureCancellationId)
      await owner.query("DELETE FROM job_cancellations WHERE id=$1", [fixtureCancellationId]);
    if (fixtureReceiptId)
      await owner.query("DELETE FROM service_receipts WHERE id=$1", [fixtureReceiptId]);
    if (fixtureTipId) await owner.query("DELETE FROM service_tips WHERE id=$1", [fixtureTipId]);
    if (fixtureTipTransactionId)
      await owner.query("DELETE FROM ledger_transactions WHERE id=$1", [fixtureTipTransactionId]);
    if (fixturePayoutId) await owner.query("DELETE FROM payouts WHERE id=$1", [fixturePayoutId]);
    if (fixtureOfferId)
      await owner.query("DELETE FROM dispatch_offers WHERE id=$1", [fixtureOfferId]);
    if (fixtureDeviceId)
      await owner.query("DELETE FROM user_devices WHERE id=$1", [fixtureDeviceId]);
    if (fixtureRatingId) await owner.query("DELETE FROM ratings WHERE id=$1", [fixtureRatingId]);
    if (fixtureFavorite)
      await owner.query("DELETE FROM favorites WHERE user_id=$1 AND merchant_id=$2", [
        fixtureFavorite.userId,
        fixtureFavorite.merchantId,
      ]);
    if (fixtureTicketId) {
      await owner.query("DELETE FROM notifications WHERE template='rls_fixture'");
      await owner.query("DELETE FROM support_tickets WHERE id=$1", [fixtureTicketId]);
    }
    await owner.end();
  }
  await client.end();
}
