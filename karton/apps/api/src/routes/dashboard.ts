import type { FastifyInstance } from 'fastify';
import { pool } from '../db.ts';
import { requireAuth } from '../auth-guards.ts';
import { todayBelgrade } from '../time.ts';

/** Dashboard agregati (spec §3.1): Danas / Posao / Novac. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', { preHandler: requireAuth }, async () => {
    const today = todayBelgrade();
    const month = today.slice(0, 7); // YYYY-MM

    const [appts, waiting, inShop, inShopList, openWO, pendingQ, monthRev, unpaid] = await Promise.all([
      pool.query(`SELECT a.id, to_char(a.date,'YYYY-MM-DD') date, to_char(a.time,'HH24:MI') time, c.name customer, v.make, v.model
        FROM appointment a JOIN customer c ON c.id=a.customer_id JOIN vehicle v ON v.id=a.vehicle_id
        WHERE a.status='scheduled' AND a.date BETWEEN $1::date AND $1::date + 1 ORDER BY a.date, a.time`, [today]),
      pool.query(`SELECT number, (SELECT plate FROM registration_history WHERE vehicle_id=wo.vehicle_id AND valid_to IS NULL LIMIT 1) plate
        FROM work_order wo WHERE status='waiting_parts' ORDER BY received_on`),
      pool.query(`SELECT count(*) n FROM work_order WHERE status IN ('open','in_progress','waiting_parts')`),
      // spec §3.1: lista vozila koja su trenutno u servisu, sa statusom naloga
      pool.query(`SELECT wo.id, wo.number, wo.status, v.make, v.model,
          (SELECT plate FROM registration_history WHERE vehicle_id=v.id AND valid_to IS NULL LIMIT 1) plate,
          c.name customer
        FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id JOIN customer c ON c.id=wo.customer_id
        WHERE wo.status IN ('open','in_progress','waiting_parts')
        ORDER BY wo.received_on, wo.id`),
      pool.query(`SELECT count(*) n FROM work_order WHERE status='open'`),
      pool.query(`SELECT count(*) n FROM document WHERE type='quote' AND status='pending'`),
      pool.query(`SELECT coalesce(sum(di.amount),0) total FROM document d JOIN document_item di ON di.document_id=d.id
        WHERE d.type='invoice' AND d.status='paid' AND to_char(d.paid_on,'YYYY-MM')=$1`, [month]),
      pool.query(`SELECT d.number, d.customer_id, c.name customer, to_char(d.due_on,'YYYY-MM-DD') due_on,
        (SELECT coalesce(sum(amount),0) FROM document_item WHERE document_id=d.id) total
        FROM document d JOIN customer c ON c.id=d.customer_id WHERE d.type='invoice' AND d.status='unpaid' ORDER BY d.due_on`),
    ]);

    const unpaidTotal = unpaid.rows.reduce((s, r) => s + Number(r.total), 0);
    return {
      today: { appointments: appts.rows, waitingParts: waiting.rows },
      business: {
        vehiclesInShop: Number(inShop.rows[0].n),
        openWorkOrders: Number(openWO.rows[0].n),
        pendingQuotes: Number(pendingQ.rows[0].n),
        inShopList: inShopList.rows,
      },
      money: { monthRevenue: Number(monthRev.rows[0].total), unpaidTotal, unpaidInvoices: unpaid.rows.map((r) => ({ ...r, total: Number(r.total) })) },
    };
  });
}
