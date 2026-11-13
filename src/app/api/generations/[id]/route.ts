import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const result = await query(
      `SELECT t.id,t.mode,t.prompt,t.name_template,t.identifier,t.tag_id,ct.name AS tag_name,
       COALESCE((SELECT json_agg(json_build_object('id',tag.id,'name',tag.name) ORDER BY lower(tag.name),tag.created_at)
                 FROM generation_task_tags task_tag JOIN creative_tags tag ON tag.id=task_tag.tag_id WHERE task_tag.task_id=t.id),'[]'::json) AS tags,
       t.settings,t.status,t.created_at,t.finished_at,u.display_name AS creator_name,
       COALESCE((SELECT json_agg(json_build_object('id',a.id,'url','/api/assets/'||a.id,'thumbnailUrl','/api/assets/'||a.id||'/thumbnail','width',a.width,'height',a.height,'mediaType',a.media_type,'originalName',a.original_name) ORDER BY task_input.position) FROM generation_task_inputs task_input JOIN media_assets a ON a.id=task_input.asset_id WHERE task_input.task_id=t.id),
                (SELECT json_agg(json_build_object('id',a.id,'url','/api/assets/'||a.id,'thumbnailUrl','/api/assets/'||a.id||'/thumbnail','width',a.width,'height',a.height,'mediaType',a.media_type,'originalName',a.original_name) ORDER BY a.created_at) FROM media_assets a WHERE a.id=t.input_asset_id),'[]'::json) AS input_assets,
       COALESCE((SELECT json_agg(json_build_object('id',r.id,'provider',r.provider,'modelKey',r.model_key,'modelId',r.model_id,'inputAssetId',r.input_asset_id,'status',r.status,'requestedCount',r.requested_count,'imageCount',r.image_count,'usage',r.usage,'estimatedCost',r.estimated_cost,'currency',r.currency,'estimatedCostCny',r.estimated_cost_cny,'errorMessage',r.error_message,'attemptCount',r.attempt_count,'retryDueAt',r.retry_due_at,'startedAt',r.started_at,'finishedAt',r.finished_at,'outputs',COALESCE((SELECT json_agg(json_build_object('id',a.id,'url','/api/assets/'||a.id,'width',a.width,'height',a.height,'originalName',a.original_name,'identifier',a.identifier) ORDER BY a.created_at) FROM media_assets a WHERE a.run_id=r.id),'[]'::json)) ORDER BY r.created_at) FROM provider_runs r WHERE r.task_id=t.id),'[]'::json) AS runs
       FROM generation_tasks t JOIN users u ON u.id=t.creator_id LEFT JOIN creative_tags ct ON ct.id=t.tag_id WHERE t.id=$1`, [id],
    );
    if (!result.rowCount) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    return NextResponse.json({ task: result.rows[0] });
  } catch (error) { return jsonError(error); }
}
