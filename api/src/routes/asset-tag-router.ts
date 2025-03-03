import express, { Request, Response, NextFunction } from "express";
import { body, param } from "express-validator";
import moment from "moment";
import _ from "lodash";

import { ReturnValidationErrors } from "../middleware";
import {
  AssetService,
  AssetTagPrinterService,
  EmailService,
  SortDirection,
  SortStatement,
} from "../services";
import { db, DB_TRUE, APPLICATION_USER } from "../data";
import { AssetItem } from "../data/models";

export const assetTagRouter = express.Router();
const assetService = new AssetService(db);
const assetTagPrinterService = new AssetTagPrinterService(db);
const emailService = new EmailService();

assetTagRouter.post("/", (req: Request, res: Response) => {
  const { assetItem } = req.body;

  return assetService
    .create({
      ...assetItem,
      status: "Active",
      condition: "Good",
    })
    .then((result) => {
      return res.status(201).json({
        data: result,
        messages: [{ variant: "success", text: "Asset created" }],
      });
    })
    .catch((error) => {
      return res.status(422).json({
        messages: [
          {
            variant: "error",
            text: "Asset failed to save",
            details: error.message,
          },
        ],
      });
    });
});

assetTagRouter.post(
  "/bulk-creation",
  [body("assetItems").isArray({ min: 1 })],
  ReturnValidationErrors,
  (req: Request, res: Response) => {
    const { assetItems } = req.body;

    const assetCreationPromises = assetItems.map(
      async (assetItem: AssetItem) => {
        const newAssetItem = await assetService.create({
          ...assetItem,
          status: "Active",
          condition: "Good",
        });

        await assetTagPrinterService.createFromAssetItem(newAssetItem);

        return newAssetItem;
      }
    );

    return Promise.all(assetCreationPromises)
      .then(async (assetItemResults: Array<AssetItem>) => {
        const tags = assetItemResults
          .map((assetItem) => assetItem.tag)
          .sort((a: string, b: string) => a.localeCompare(b));

        await emailService.sendTagRequestComplete(req.user, tags);
        await emailService.sendTagRequestNotification(APPLICATION_USER, tags);

        return res.status(201).json({
          data: assetItemResults,
          messages: [{ variant: "success", text: "Assets created" }],
        });
      })
      .catch((error: { message: string }) => {
        return res.status(422).json({
          messages: [
            {
              variant: "error",
              text: "Assets failed to save",
              details: error.message,
            },
          ],
        });
      });
  }
);

assetTagRouter.post(
  "/query",
  [body("page").isInt().default(1), body("itemsPerPage").isInt().default(10)],
  async (req: Request, res: Response) => {
    let { query, sortBy, sortDesc, page, itemsPerPage } = req.body;
    let sort = new Array<SortStatement>();

    sortBy.forEach((s: string, i: number) => {
      sort.push({
        field: s,
        direction: sortDesc[i]
          ? SortDirection.ASCENDING
          : SortDirection.DESCENDING,
      });
    });

    let skip = (page - 1) * itemsPerPage;
    let take = itemsPerPage;

    let results = await assetService.doSearch(
      query,
      sort,
      page,
      itemsPerPage,
      skip,
      take
    );

    return res.json(results);
  }
);

assetTagRouter.post(
  "/search",
  [body("keyword").notEmpty()],
  ReturnValidationErrors,
  async (req: Request, res: Response) => {
    let { keyword } = req.body;

    let results = await assetService.doItemSearch(keyword);

    for (let row of results) {
      row.owner = await db("asset_owner")
        .where({ id: row.asset_owner_id })
        .first();

      if (row.purchase_date)
        row.purchase_date = moment(row.purchase_date)
          .utc(true)
          .format("YYYY-MM-DD");

      if (row.dept_tag) row.display = `${row.tag} (${row.dept_tag})`;
      else row.display = `${row.tag} : ${row.description}`;
    }

    return res.json({ data: results });
  }
);

assetTagRouter.put(
  "/:id",
  [param("id").isInt().notEmpty()],
  ReturnValidationErrors,
  async (req: Request, res: Response) => {
    let { id } = req.params;

    let item = await db("asset_item").where({ id }).first();
    const default_owner = await db("asset_owner")
      .where({ default_owner: DB_TRUE })
      .first();

    if (item) {
      let {
        tag,
        dept_tag,
        status,
        condition,
        asset_owner_id,
        un_commodity_code,
        make,
        model,
        comment,
      } = req.body;
      let {
        serial,
        description,
        purchase_person,
        purchase_price,
        purchase_date,
        purchase_order_number,
        purchase_order_line,
      } = req.body;

      let body = {
        tag,
        dept_tag,
        status,
        condition,
        asset_owner_id,
        un_commodity_code,
        make,
        model,
        serial,
        description,
        purchase_person,
        purchase_price,
        purchase_date,
        purchase_order_number,
        purchase_order_line,
        comment,
      };

      if (item.asset_owner_id != asset_owner_id) {
        // do a transfer to the new owner
        console.log(
          "Generating a transfer from " +
          item.asset_owner_id +
          " to " +
          asset_owner_id
        );

        if (asset_owner_id == default_owner.id) {
          // this is an inbound transfer
          let transfer = {
            asset_item_id: id,
            request_user: req.user.email,
            request_date: new Date(),
            transfer_date: new Date(),
            condition: status,
            from_owner_id: item.asset_owner_id,
            to_owner_id: asset_owner_id,
            quantity: 1,
          };

          await db("asset_transfer").insert(transfer);
        } else {
          let now = moment();
          //this is inbound and outbound
          let transfer1 = {
            asset_item_id: id,
            request_user: req.user.email,
            request_date: now.toDate(),
            transfer_date: now.toDate(),
            condition: status,
            from_owner_id: item.asset_owner_id,
            to_owner_id: default_owner.id,
            quantity: 1,
          };
          await db("asset_transfer").insert(transfer1);

          now = now.add(1, "second");

          let transfer2 = {
            asset_item_id: id,
            request_user: req.user.email,
            request_date: now.toDate(),
            transfer_date: now.toDate(),
            condition: status,
            from_owner_id: default_owner.id,
            to_owner_id: asset_owner_id,
            quantity: 1,
          };
          await db("asset_transfer").insert(transfer2);
        }
      }

      await db("asset_item").where({ id }).update(body);
      return res.json({
        messages: [{ variant: "success", text: "Asset saved" }],
      });
    }

    res.status(404).send();
  }
);

assetTagRouter.put(
  "/:id/limited",
  [param("id").isInt().notEmpty()],
  ReturnValidationErrors,
  async (req: Request, res: Response) => {
    let { id } = req.params;

    let item = await db("asset_item").where({ id }).first();

    if (item) {
      let {
        dept_tag,
        status,
        condition,
        un_commodity_code,
        make,
        model,
        comment,
      } = req.body;
      let {
        serial,
        description,
        purchase_person,
        purchase_price,
        purchase_date,
        purchase_order_number,
        purchase_order_line,
      } = req.body;

      let body = {
        dept_tag,
        status,
        condition,
        un_commodity_code,
        make,
        model,
        serial,
        description,
        purchase_person,
        purchase_price,
        purchase_date,
        purchase_order_number,
        purchase_order_line,
        comment,
      };

      await db("asset_item").where({ id }).update(body);
      return res.json({
        messages: [{ variant: "success", text: "Asset saved" }],
      });
    }

    res.status(404).send();
  }
);

assetTagRouter.put(
  "/:id/limited/transfer",
  [param("id").isInt().notEmpty()],
  ReturnValidationErrors,
  async (req: Request, res: Response) => {
    let { id } = req.params;

    let item = await db("asset_item").where({ id }).first();
    const default_owner = await db("asset_owner")
      .where({ default_owner: DB_TRUE })
      .first();

    if (item) {
      let {
        dept_tag,
        status,
        condition,
        asset_owner_id,
        un_commodity_code,
        make,
        model,
        comment,
      } = req.body;
      let {
        serial,
        description,
        purchase_person,
        purchase_price,
        purchase_date,
        purchase_order_number,
        purchase_order_line,
      } = req.body;

      let body = {
        dept_tag,
        status,
        condition,
        asset_owner_id,
        un_commodity_code,
        make,
        model,
        serial,
        description,
        purchase_person,
        purchase_price,
        purchase_date,
        purchase_order_number,
        purchase_order_line,
        comment,
      };

      await db("asset_item").where({ id }).update(body);

      let transfer = {
        asset_item_id: id,
        request_user: req.user.email,
        request_date: new Date(),
        transfer_date: new Date(),
        condition: `REQUEST: ${condition}`,
        from_owner_id: asset_owner_id,
        to_owner_id: default_owner.id,
        quantity: 1,
      };

      await db("asset_transfer").insert(transfer);

      return res.json({
        messages: [{ variant: "success", text: "Asset saved" }],
      });
    }

    res.status(404).send();
  }
);

assetTagRouter.get(
  "/asset-category",
  async (req: Request, res: Response, next: NextFunction) => {
    let list = await db("asset_category").catch(next);

    return res.json({ data: list });
  }
);

assetTagRouter.post("/print-tags",
  [body("tags").isArray()], ReturnValidationErrors,
  async (req: Request, res: Response) => {
    let currentUser = req.user;
    let { tags } = req.body;

    let printed = 0;

    for (let tag of tags) {

      await db("asset_tag_print_queue").where({ tag }).delete();

      let { purchase_date, description, department, mailcode, purchase_person } = await db("asset_item").join("asset_owner", "asset_item.asset_owner_id", "asset_owner.id")
        .where({ tag })
        .select(["asset_item.purchase_date", "asset_item.description", "asset_owner.department", "asset_owner.mailcode", "asset_item.purchase_person"])
        .first();

      if (purchase_date) {
        let toInsert = { tag, purchase_date, description, department, mailcode, print_date: new Date(), print_person: currentUser.email, purchase_person };
        await db("asset_tag_print_queue").insert(toInsert);
        printed++;
      }
    }

    res.json({ messages: [{ text: `Sent ${printed} tags to the printer queue`, variant: "success" }] });
  });

assetTagRouter.delete("/:id", async (req: Request, res: Response) => {
  let { id } = req.params;

  await db("asset_item").where({ id }).delete();
  await db("asset_transfer").where({ asset_item_id: id }).delete();

  return res.json({
    data: {},
    messages: [{ variant: "success", text: "Asset deleted" }],
  });
});
