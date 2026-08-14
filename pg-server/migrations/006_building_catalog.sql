BEGIN;

CREATE TABLE IF NOT EXISTS static.buildings (
  building_id bigserial PRIMARY KEY,
  building_name text NOT NULL UNIQUE,
  location geometry(Point, 4490) NOT NULL,
  source_lng numeric(10, 7),
  source_lat numeric(9, 7),
  altitude_m numeric(8, 2),
  altitude_is_placeholder boolean NOT NULL DEFAULT true,
  category text,
  merged_count integer NOT NULL DEFAULT 1 CHECK (merged_count > 0),
  source_dataset text NOT NULL,
  source_crs text NOT NULL DEFAULT 'EPSG:4326',
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now()
);

ALTER TABLE static.buildings
  ADD COLUMN IF NOT EXISTS source_lng numeric(10, 7),
  ADD COLUMN IF NOT EXISTS source_lat numeric(9, 7);

CREATE INDEX IF NOT EXISTS idx_static_buildings_location
  ON static.buildings USING gist (location);

CREATE INDEX IF NOT EXISTS idx_static_buildings_category
  ON static.buildings (category, building_name);

WITH seed(building_name, lng, lat, altitude_m, category, merged_count) AS (
  VALUES
    ('110报警中心/保卫处', 118.9478560, 32.1184645, 25.0, 'university', 1),
    ('15栋快递自提柜', 118.9580017, 32.1177229, 25.0, 'yes', 1),
    ('6栋快递自提柜', 118.9523177, 32.1168021, 25.0, 'yes', 1),
    ('仙林校区第二体育场附属体育馆', 118.9464376, 32.1233658, 25.0, 'yes', 1),
    ('方肇周体育馆', 118.9510165, 32.1148087, 25.0, 'stadium', 1),
    ('侨裕楼（外国语学院）', 118.9559532, 32.1184383, 25.0, 'university', 1),
    ('信息化建设管理服务中心', 118.9552931, 32.1174015, 25.0, 'yes', 1),
    ('信息管理学院', 118.9554817, 32.1192010, 25.0, 'university', 1),
    ('公共教学楼一区', 118.9545304, 32.1138280, 25.0, 'university', 2),
    ('公共教学楼二区', 118.9539516, 32.1144472, 25.0, 'university', 2),
    ('勇园快递站', 118.9468719, 32.1254215, 25.0, 'yes', 1),
    ('化学化工学院', 118.9474009, 32.1207361, 25.0, 'university', 10),
    ('化学和生物医药创新研究院 实验动物影像中心', 118.9516541, 32.1225058, 25.0, 'yes', 1),
    ('匡亚明学院', 118.9551886, 32.1188181, 25.0, 'university', 1),
    ('南京大学医院', 118.9479246, 32.1178825, 25.0, 'university', 1),
    ('南京大学档案馆', 118.9544063, 32.1172603, 25.0, 'yes', 1),
    ('南京大学美术馆', 118.9577215, 32.1161319, 25.0, 'yes', 1),
    ('南京大学量子材料微结构研究中心', 118.9540769, 32.1277766, 25.0, 'university', 1),
    ('南大国际会议中心', 118.9580022, 32.1164621, 25.0, 'yes', 1),
    ('南大科学园管委会', 118.9582677, 32.1184161, 25.0, 'school', 1),
    ('历史学院', 118.9542234, 32.1211553, 25.0, 'university', 1),
    ('哲学系', 118.9538422, 32.1187677, 25.0, 'university', 1),
    ('四组团十一食堂站', 118.9475887, 32.1253956, 25.0, 'yes', 1),
    ('国际关系学院', 118.9516377, 32.1216963, 25.0, 'university', 1),
    ('国际学院', 118.9541239, 32.1125679, 25.0, 'university', 1),
    ('垃圾场', 118.9576186, 32.1183739, 25.0, 'yes', 1),
    ('基础医学中心', 118.9493628, 32.1221460, 25.0, 'university', 1),
    ('基础实验楼', 118.9519601, 32.1124282, 25.0, 'university', 8),
    ('大气科学学院', 118.9500719, 32.1198657, 25.0, 'university', 5),
    ('天文与空间科学学院', 118.9548269, 32.1275724, 25.0, 'university', 1),
    ('学生公寓16幢', 118.9462214, 32.1247551, 25.0, 'university', 1),
    ('学生公寓17幢', 118.9463192, 32.1255981, 25.0, 'university', 1),
    ('学生公寓18幢', 118.9463604, 32.1264137, 25.0, 'dormitory', 1),
    ('学生公寓19幢', 118.9471439, 32.1264720, 25.0, 'dormitory', 1),
    ('学生公寓20幢', 118.9479306, 32.1265669, 25.0, 'dormitory', 1),
    ('学生公寓21幢/招待所/留学生公寓', 118.9487159, 32.1266172, 25.0, 'dormitory', 1),
    ('学生公寓22幢', 118.9472446, 32.1258923, 25.0, 'dormitory', 1),
    ('学生公寓23幢', 118.9483685, 32.1258265, 25.0, 'dormitory', 1),
    ('学生公寓24幢', 118.9482879, 32.1249807, 25.0, 'dormitory', 1),
    ('学生公寓26、27幢', 118.9498721, 32.1261269, 25.0, 'dormitory', 1),
    ('学生宿舍10幢', 118.9514561, 32.1183722, 25.0, 'dormitory', 1),
    ('学生宿舍11幢', 118.9509367, 32.1190879, 25.0, 'dormitory', 1),
    ('学生宿舍12幢', 118.9569823, 32.1169592, 25.0, 'university', 1),
    ('学生宿舍13幢', 118.9564633, 32.1177117, 25.0, 'dormitory', 1),
    ('学生宿舍15幢', 118.9582390, 32.1177227, 25.0, 'dormitory', 1),
    ('学生宿舍1幢', 118.9495802, 32.1145310, 25.0, 'dormitory', 1),
    ('学生宿舍25幢', 118.9540883, 32.1272251, 25.0, 'dormitory', 1),
    ('学生宿舍2幢', 118.9502262, 32.1161748, 25.0, 'dormitory', 1),
    ('学生宿舍3幢', 118.9489996, 32.1157199, 25.0, 'dormitory', 1),
    ('学生宿舍4幢', 118.9496371, 32.1173238, 25.0, 'dormitory', 1),
    ('学生宿舍5幢', 118.9484190, 32.1168922, 25.0, 'dormitory', 1),
    ('学生宿舍6幢', 118.9524933, 32.1173865, 25.0, 'dormitory', 1),
    ('学生宿舍7幢', 118.9513854, 32.1168472, 25.0, 'dormitory', 1),
    ('学生宿舍8幢', 118.9519545, 32.1179078, 25.0, 'dormitory', 1),
    ('学生宿舍9幢', 118.9508749, 32.1178130, 25.0, 'dormitory', 1),
    ('学生第八餐厅、第九餐厅、清真餐厅、', 118.9503877, 32.1188880, 25.0, 'yes', 1),
    ('学生第十一餐厅', 118.9470652, 32.1249366, 25.0, 'yes', 1),
    ('学生第十食堂/教工餐厅', 118.9580447, 32.1171775, 25.0, 'yes', 1),
    ('学生第四、五、六餐厅', 118.9500540, 32.1134475, 25.0, 'yes', 1),
    ('左涤江天文台', 118.9555989, 32.1241483, 25.0, 'yes', 1),
    ('左涤江楼', 118.9544195, 32.1128223, 25.0, 'university', 1),
    ('常州楼（计算机科学与技术系）', 118.9581038, 32.1132389, 25.0, 'university', 1),
    ('扬州楼（行政北楼）', 118.9578324, 32.1149825, 25.0, 'yes', 1),
    ('政府管理学院', 118.9547817, 32.1195518, 25.0, 'university', 1),
    ('敬文学生活动中心', 118.9526134, 32.1160409, 25.0, 'yes', 1),
    ('文学院', 118.9547242, 32.1182962, 25.0, 'university', 1),
    ('新闻传播学院', 118.9544950, 32.1219920, 25.0, 'university', 1),
    ('昆山楼(地理与海洋科学学院)', 118.9565386, 32.1147422, 25.0, 'yes', 1),
    ('朱共山楼（地球科学与工程学院）', 118.9564662, 32.1139970, 25.0, 'yes', 1),
    ('杜厦图书馆', 118.9549885, 32.1163152, 25.0, 'yes', 1),
    ('校史馆（沈小平楼）', 118.9531983, 32.1167014, 25.0, 'university', 1),
    ('气象观测站', 118.9527951, 32.1205562, 25.0, 'yes', 1),
    ('淳朴亭', 118.9507778, 32.1207531, 25.0, 'yes', 1),
    ('游泳馆', 118.9532672, 32.1183555, 25.0, 'yes', 1),
    ('潘忠来楼（电子科学与工程学院）', 118.9567455, 32.1130735, 25.0, 'university', 1),
    ('环境学院', 118.9478405, 32.1193188, 25.0, 'university', 3),
    ('现代工程与应用科学学院', 118.9501002, 32.1233673, 25.0, 'university', 1),
    ('生命科学学院', 118.9497798, 32.1214454, 25.0, 'university', 7),
    ('社会学院', 118.9548563, 32.1203160, 25.0, 'university', 4),
    ('花房', 118.9486936, 32.1187950, 25.0, 'university', 1),
    ('菜根谭快递站', 118.9517518, 32.1165018, 25.0, 'yes', 1),
    ('行政南楼', 118.9579917, 32.1141869, 25.0, 'yes', 1),
    ('逸夫楼', 118.9548756, 32.1128814, 25.0, 'university', 1)
)
INSERT INTO static.buildings (
  building_name,
  location,
  source_lng,
  source_lat,
  altitude_m,
  altitude_is_placeholder,
  category,
  merged_count,
  source_dataset,
  source_crs
)
SELECT
  building_name,
  ST_Transform(ST_SetSRID(ST_MakePoint(lng, lat), 4326), 4490),
  lng,
  lat,
  altitude_m,
  true,
  category,
  merged_count,
  '点位清单.docx@2026-08-10',
  'EPSG:4326'
FROM seed
ON CONFLICT (building_name) DO UPDATE SET
  location = EXCLUDED.location,
  source_lng = EXCLUDED.source_lng,
  source_lat = EXCLUDED.source_lat,
  altitude_m = EXCLUDED.altitude_m,
  altitude_is_placeholder = EXCLUDED.altitude_is_placeholder,
  category = EXCLUDED.category,
  merged_count = EXCLUDED.merged_count,
  source_dataset = EXCLUDED.source_dataset,
  source_crs = EXCLUDED.source_crs,
  updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'building_node_distance_building_name_fkey'
      AND conrelid = 'static.building_node_distance'::regclass
  ) THEN
    ALTER TABLE static.building_node_distance
      ADD CONSTRAINT building_node_distance_building_name_fkey
      FOREIGN KEY (building_name)
      REFERENCES static.buildings(building_name)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
DECLARE
  official_buildings integer;
  fixed_nodes integer;
  matrix_rows integer;
  invalid_buildings integer;
BEGIN
  SELECT COUNT(*) INTO official_buildings
  FROM static.buildings
  WHERE source_dataset = '点位清单.docx@2026-08-10';

  SELECT COUNT(*) INTO fixed_nodes
  FROM static.fixed_nodes
  WHERE node_code IN ('hub', 'a', 'b', 'c', 'd', 'e', 'A', 'B', 'C', 'D', 'E', 'F', 'G');

  SELECT COUNT(*) INTO matrix_rows
  FROM static.building_node_distance d
  JOIN static.buildings b ON b.building_name = d.building_name
  WHERE b.source_dataset = '点位清单.docx@2026-08-10'
    AND d.node_code IN ('hub', 'a', 'b', 'c', 'd', 'e', 'A', 'B', 'C', 'D', 'E', 'F', 'G');

  SELECT COUNT(*) INTO invalid_buildings
  FROM (
    SELECT b.building_name
    FROM static.buildings b
    LEFT JOIN static.building_node_distance d
      ON d.building_name = b.building_name
    WHERE b.source_dataset = '点位清单.docx@2026-08-10'
      AND d.node_code IN ('hub', 'a', 'b', 'c', 'd', 'e', 'A', 'B', 'C', 'D', 'E', 'F', 'G')
    GROUP BY b.building_name
    HAVING COUNT(d.node_code) <> 13
  ) incomplete;

  IF official_buildings <> 83 THEN
    RAISE EXCEPTION 'Expected 83 official buildings, found %', official_buildings;
  END IF;
  IF fixed_nodes <> 13 THEN
    RAISE EXCEPTION 'Expected 13 fixed nodes, found %', fixed_nodes;
  END IF;
  IF matrix_rows <> 1079 THEN
    RAISE EXCEPTION 'Expected 1079 building-node distances, found %', matrix_rows;
  END IF;
  IF invalid_buildings <> 0 THEN
    RAISE EXCEPTION '% official buildings do not have exactly 13 node distances', invalid_buildings;
  END IF;
END
$$;

ANALYZE static.buildings;
ANALYZE static.building_node_distance;

COMMIT;
