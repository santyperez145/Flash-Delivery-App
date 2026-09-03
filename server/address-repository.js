// Libreta de direcciones del cliente (ARC-001).
//
// Separada de auth/sesión: geocoding firmado y default viven con el domicilio,
// no con el refresh token.
import { postgresPool } from "./postgres.js";

export async function getPostgresAddresses(userPublicId = null) {
  const values = userPublicId ? [userPublicId] : [],
    where = userPublicId ? "WHERE u.public_id=$1" : "";
  const [addresses, users] = await Promise.all([
    postgresPool.query(
      `SELECT a.id::text,u.public_id user_id,a.label,a.formatted_address address,
        ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,a.is_default,
        a.geocoding_provider,a.provider_place_id,a.geocode_type,a.geocoded_at,a.created_at,a.updated_at
       FROM addresses a JOIN users u ON u.id=a.user_id ${where}
       ORDER BY a.is_default DESC,a.created_at`,
      values,
    ),
    postgresPool.query(
      userPublicId
        ? `SELECT public_id,profile->>'defaultAddress' address FROM users u
          WHERE u.public_id=$1 AND COALESCE(profile->>'defaultAddress','')<>''`
        : `SELECT public_id,profile->>'defaultAddress' address FROM users u
          WHERE COALESCE(profile->>'defaultAddress','')<>''`,
      values,
    ),
  ]);
  const result = addresses.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    label: row.label,
    address: row.address,
    lat: Number(row.lat),
    lng: Number(row.lng),
    isDefault: row.is_default,
    geocodingProvider: row.geocoding_provider || null,
    providerPlaceId: row.provider_place_id || null,
    geocodeType: row.geocode_type || null,
    validatedAt: row.geocoded_at?.toISOString?.() || null,
    isValidated: Boolean(row.geocoded_at),
  }));
  const represented = new Set(
    result.filter((entry) => entry.isDefault).map((entry) => entry.userId),
  );
  for (const row of users.rows)
    if (!represented.has(row.public_id))
      result.push({
        id: `profile-${row.public_id}`,
        userId: row.public_id,
        label: "Principal",
        address: row.address,
        lat: null,
        lng: null,
        isDefault: true,
        geocodingProvider: null,
        providerPlaceId: null,
        geocodeType: null,
        validatedAt: null,
        isValidated: false,
      });
  return result;
}

function mapAddress(row) {
  return {
    id: String(row.id),
    userId: row.user_public_id,
    label: row.label,
    address: row.formatted_address,
    lat: Number(row.lat),
    lng: Number(row.lng),
    isDefault: row.is_default,
    geocodingProvider: row.geocoding_provider || null,
    providerPlaceId: row.provider_place_id || null,
    geocodeType: row.geocode_type || null,
    validatedAt: row.geocoded_at?.toISOString?.() || null,
    isValidated: Boolean(row.geocoded_at),
  };
}
const addressReturning = `a.id,a.label,a.formatted_address,a.is_default,
  a.geocoding_provider,a.provider_place_id,a.geocode_type,a.geocoded_at,
  ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,u.public_id user_public_id`;

export async function createPostgresAddress({
  userPublicId,
  label,
  address,
  lat,
  lng,
  isDefault,
  provider,
  providerPlaceId,
  geocodeType,
  verifiedAt,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (
      await client.query("SELECT id FROM users WHERE public_id=$1 FOR UPDATE", [userPublicId])
    ).rows[0];
    if (!user) {
      const error = new Error("Usuario no existe");
      error.status = 404;
      throw error;
    }
    const count = Number(
      (await client.query("SELECT count(*)::int count FROM addresses WHERE user_id=$1", [user.id]))
        .rows[0].count,
    );
    if (count >= 10) {
      const error = new Error("Alcanzaste el máximo de 10 direcciones");
      error.status = 409;
      throw error;
    }
    const makeDefault = Boolean(isDefault) || count === 0;
    if (makeDefault)
      await client.query(
        "UPDATE addresses SET is_default=false,updated_at=now() WHERE user_id=$1 AND is_default",
        [user.id],
      );
    const result = await client.query(
      `INSERT INTO addresses(
        user_id,label,formatted_address,location,is_default,geocoding_provider,
        provider_place_id,geocode_type,geocoded_at
       ) VALUES(
        $1,$2,$3,ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,$6,$7,$8,$9,$10
       ) RETURNING *`,
      [
        user.id,
        label,
        address,
        lat,
        lng,
        makeDefault,
        provider,
        providerPlaceId,
        geocodeType,
        verifiedAt,
      ],
    );
    if (makeDefault)
      await client.query(
        "UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE id=$1",
        [user.id, address],
      );
    await client.query("COMMIT");
    return mapAddress({ ...result.rows[0], user_public_id: userPublicId, lat, lng });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePostgresAddress({
  userPublicId,
  addressId,
  label,
  address,
  lat,
  lng,
  isDefault,
  provider,
  providerPlaceId,
  geocodeType,
  verifiedAt,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const owned = (
      await client.query(
        "SELECT a.*,u.public_id user_public_id FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.public_id=$2 FOR UPDATE",
        [addressId, userPublicId],
      )
    ).rows[0];
    if (!owned) {
      const error = new Error("Dirección no encontrada");
      error.status = 404;
      throw error;
    }
    if (isDefault)
      await client.query(
        "UPDATE addresses SET is_default=false,updated_at=now() WHERE user_id=$1 AND id<>$2 AND is_default",
        [owned.user_id, addressId],
      );
    const result = await client.query(
      `UPDATE addresses a SET
        label=$3,formatted_address=$4,
        location=ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,
        is_default=CASE WHEN $7 THEN true ELSE is_default END,
        geocoding_provider=$8,provider_place_id=$9,geocode_type=$10,geocoded_at=$11,updated_at=now()
       FROM users u
       WHERE a.id=$1 AND a.user_id=u.id AND u.public_id=$2
       RETURNING ${addressReturning}`,
      [
        addressId,
        userPublicId,
        label,
        address,
        lat,
        lng,
        Boolean(isDefault),
        provider,
        providerPlaceId,
        geocodeType,
        verifiedAt,
      ],
    );
    const updated = result.rows[0];
    if (updated.is_default)
      await client.query(
        "UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE public_id=$1",
        [userPublicId, address],
      );
    await client.query("COMMIT");
    return mapAddress(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setPostgresDefaultAddress({ userPublicId, addressId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const owned = (
      await client.query(
        "SELECT a.id,a.user_id,a.formatted_address FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.public_id=$2 FOR UPDATE",
        [addressId, userPublicId],
      )
    ).rows[0];
    if (!owned) {
      const error = new Error("Dirección no encontrada");
      error.status = 404;
      throw error;
    }
    await client.query(
      "UPDATE addresses SET is_default=false,updated_at=now() WHERE user_id=$1 AND id<>$2 AND is_default",
      [owned.user_id, addressId],
    );
    await client.query(
      "UPDATE addresses SET is_default=true,updated_at=CASE WHEN is_default THEN updated_at ELSE now() END WHERE id=$1",
      [addressId],
    );
    await client.query(
      "UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE public_id=$1",
      [userPublicId, owned.formatted_address],
    );
    await client.query("COMMIT");
    return (await getPostgresAddresses(userPublicId)).find(
      (entry) => entry.id === String(addressId),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresAddress({ userPublicId, addressId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const owned = (
      await client.query(
        "SELECT a.id,a.user_id,a.is_default FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.public_id=$2 FOR UPDATE",
        [addressId, userPublicId],
      )
    ).rows[0];
    if (!owned) {
      const error = new Error("Dirección no encontrada");
      error.status = 404;
      throw error;
    }
    await client.query("DELETE FROM addresses WHERE id=$1", [addressId]);
    if (owned.is_default) {
      const replacement = (
        await client.query(
          "UPDATE addresses SET is_default=true,updated_at=now() WHERE id=(SELECT id FROM addresses WHERE user_id=$1 ORDER BY created_at LIMIT 1) RETURNING formatted_address",
          [owned.user_id],
        )
      ).rows[0];
      await client.query(
        "UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE public_id=$1",
        [userPublicId, replacement?.formatted_address || ""],
      );
    }
    await client.query("COMMIT");
    return getPostgresAddresses(userPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
