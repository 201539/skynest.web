-- 将早期演示版限制区预设迁移到 V3 正式校园点位。
-- 仅匹配旧预设中心 2 米内的记录；保留原半径、时段、状态及业务字段。
WITH preset_coordinates(old_lng, old_lat, new_lng, new_lat) AS (
  VALUES
    (118.9479::double precision, 32.1101::double precision, 118.9510165::double precision, 32.1148087::double precision),
    (118.9492::double precision, 32.1082::double precision, 118.9549885::double precision, 32.1163152::double precision),
    (118.9490::double precision, 32.1068::double precision, 118.9567400::double precision, 32.1118100::double precision)
), matched AS (
  SELECT
    n.zone_id,
    p.new_lng,
    p.new_lat,
    ST_Perimeter(ST_Transform(n.zone, 4326)::geography) / (2 * pi()) AS radius_m
  FROM runtime.no_fly_zones n
  JOIN preset_coordinates p ON ST_DWithin(
    ST_Transform(ST_Centroid(n.zone), 4326)::geography,
    ST_SetSRID(ST_MakePoint(p.old_lng, p.old_lat), 4326)::geography,
    2
  )
)
UPDATE runtime.no_fly_zones n
SET zone = ST_Transform(
  ST_Buffer(
    ST_SetSRID(ST_MakePoint(m.new_lng, m.new_lat), 4326)::geography,
    m.radius_m
  )::geometry,
  4490
)
FROM matched m
WHERE n.zone_id = m.zone_id;
