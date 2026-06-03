-- 仙林校区 3D 适航格网数据库结构（参考）
-- 数据库: nanjing_uni_grid_score
-- PostgreSQL 18
-- 运行: node setup-db.js

CREATE TABLE IF NOT EXISTS nanjing_uni_3d_grid_new (
  x_min DOUBLE PRECISION NOT NULL,
  x_max DOUBLE PRECISION NOT NULL,
  y_min DOUBLE PRECISION NOT NULL,
  y_max DOUBLE PRECISION NOT NULL,
  z_min DOUBLE PRECISION NOT NULL,
  z_max DOUBLE PRECISION NOT NULL,
  static_suitability_score DOUBLE PRECISION
);

-- bbox 空间过滤（240 万条必需）
CREATE INDEX IF NOT EXISTS idx_grid_bbox
  ON nanjing_uni_3d_grid_new (x_min, x_max, y_min, y_max);

-- 航点评估：按 xy 定位 + z 排序
CREATE INDEX IF NOT EXISTS idx_grid_xy_z
  ON nanjing_uni_3d_grid_new (x_min, y_min, z_min);

-- 统计
-- SELECT COUNT(*) FROM nanjing_uni_3d_grid_new;
