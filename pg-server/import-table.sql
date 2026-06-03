-- 兼容导入：用 text 替代 PostGIS 类型（无需安装 PostGIS）
DROP TABLE IF EXISTS public.nanjing_uni_3d_grid_new CASCADE;

CREATE TABLE public.nanjing_uni_3d_grid_new (
    new_id integer,
    grid_code text,
    geom text,
    x_min double precision,
    x_max double precision,
    y_min double precision,
    y_max double precision,
    z_min double precision,
    z_max double precision,
    has_building boolean,
    geomm text,
    pop double precision,
    landcover integer,
    building_remark numeric(3,1),
    building_class text,
    sensitivity_level double precision,
    privacy_level double precision,
    pop_remark double precision,
    landcover_remark double precision,
    static_suitability_score double precision,
    building_evaluation_score double precision
);

CREATE INDEX IF NOT EXISTS idx_grid_bbox ON public.nanjing_uni_3d_grid_new (x_min, x_max, y_min, y_max);
CREATE INDEX IF NOT EXISTS idx_grid_xy_z ON public.nanjing_uni_3d_grid_new (x_min, y_min, z_min);
