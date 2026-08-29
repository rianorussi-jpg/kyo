-- KYO v11
-- No agrega columnas nuevas: product_customizations.sort_order ya existe desde v10.
-- El orden que selecciones en el panel se guarda en esa columna.
-- Esta migración solo normaliza órdenes existentes por producto.
with ranked as (
  select product_id, template_id,
         row_number() over (partition by product_id order by sort_order, template_id) * 10 as new_order
  from public.product_customizations
)
update public.product_customizations pc
set sort_order = r.new_order
from ranked r
where pc.product_id=r.product_id and pc.template_id=r.template_id;
