package forge.web.server.roadmap

import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.count
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

@Serializable
internal data class RoadmapItem(
    val id: String,
    val title: String,
    val description: String,
    val status: String,
    val note: String?,
    val statusUpdatedAt: String?,
    val votes: Int,
    val voted: Boolean,
)

internal class RoadmapStore(private val database: Database) {
    private object Items : Table("roadmap_items") {
        val id = text("id")
        val title = text("title")
        val description = text("description")
        val status = text("status")
        val note = text("note").nullable()
        val statusUpdatedAt = text("status_updated_at").nullable()
        val sortOrder = integer("sort_order")
        val visible = bool("visible")
        override val primaryKey = PrimaryKey(id)
    }

    private object Votes : Table("roadmap_votes") {
        val itemId = text("item_id")
        val playerId = text("player_id")
        override val primaryKey = PrimaryKey(itemId, playerId)
    }

    fun list(playerId: String?): List<RoadmapItem> =
        transaction(database) {
            val items = Items.selectAll().where { Items.visible eq true }.orderBy(Items.sortOrder).toList()
            val ids = items.map { it[Items.id] }
            if (ids.isEmpty()) return@transaction emptyList()
            val voteCount = Votes.playerId.count()
            val counts =
                Votes.select(Votes.itemId, voteCount)
                    .where { Votes.itemId inList ids }
                    .groupBy(Votes.itemId)
                    .associate { it[Votes.itemId] to it[voteCount].toInt() }
            val selected =
                if (playerId == null) {
                    emptySet()
                } else {
                    Votes.select(Votes.itemId)
                        .where { (Votes.playerId eq playerId) and (Votes.itemId inList ids) }
                        .mapTo(mutableSetOf()) { it[Votes.itemId] }
                }
            items.map { row ->
                RoadmapItem(
                    id = row[Items.id],
                    title = row[Items.title],
                    description = row[Items.description],
                    status = row[Items.status],
                    note = row[Items.note],
                    statusUpdatedAt = row[Items.statusUpdatedAt],
                    votes = counts[row[Items.id]] ?: 0,
                    voted = row[Items.id] in selected,
                )
            }
        }

    fun vote(
        itemId: String,
        playerId: String,
        selected: Boolean,
    ): Boolean =
        transaction(database) {
            val item = Items.selectAll().where { Items.id eq itemId }.firstOrNull()
            if (item == null || !item[Items.visible] || item[Items.status] == "shipped") return@transaction false
            if (selected) {
                Votes.insertIgnore {
                    it[Votes.itemId] = itemId
                    it[Votes.playerId] = playerId
                }
            } else {
                Votes.deleteWhere { (Votes.itemId eq itemId) and (Votes.playerId eq playerId) }
            }
            true
        }
}
