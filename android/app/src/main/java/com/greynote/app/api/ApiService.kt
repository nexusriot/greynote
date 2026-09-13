package com.greynote.app.api

import com.greynote.app.api.model.*
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {
    @GET("api/version")
    suspend fun version(): Response<VersionResponse>

    @POST("api/login")
    suspend fun login(@Body req: LoginRequest): Response<Unit>

    @POST("api/logout")
    suspend fun logout(): Response<Unit>

    @GET("api/me")
    suspend fun me(): Response<MeResponse>

    @PUT("api/account/password")
    suspend fun changePassword(@Body req: ChangePasswordRequest): Response<Unit>

    // Retrofit refuses @Body on @DELETE, and closing an account has to carry
    // the password, so this one is spelled out with @HTTP.
    @HTTP(method = "DELETE", path = "api/account", hasBody = true)
    suspend fun deleteAccount(@Body req: PasswordRequest): Response<Unit>

    @GET("api/sessions")
    suspend fun sessions(): Response<List<SessionInfo>>

    @DELETE("api/sessions/{id}")
    suspend fun revokeSession(@Path("id") id: Long): Response<Unit>

    // ---- administration ----------------------------------------------------

    @GET("api/admin/users")
    suspend fun users(): Response<List<AdminUser>>

    @POST("api/admin/users")
    suspend fun createUser(@Body req: CreateUserRequest): Response<Unit>

    @PUT("api/admin/users/{id}/admin")
    suspend fun setUserAdmin(@Path("id") id: Long, @Body req: AdminFlagRequest): Response<Unit>

    @DELETE("api/admin/users/{id}")
    suspend fun deleteUser(@Path("id") id: Long): Response<Unit>

    // ---- notes -------------------------------------------------------------

    @GET("api/notes")
    suspend fun listNotes(
        @Query("full") full: Int? = null,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null,
        @Query("tag") tag: String? = null,
        @Query("folder") folder: String? = null,
    ): Response<List<Note>>

    @POST("api/notes")
    suspend fun createNote(@Body req: NoteUpsertRequest): Response<CreateNoteResponse>

    @GET("api/notes/{id}")
    suspend fun getNote(@Path("id") id: Long): Response<Note>

    // If-Match carries the note version the client loaded, so the server can
    // reject a save that would overwrite a newer one from another device.
    @PUT("api/notes/{id}")
    suspend fun updateNote(
        @Path("id") id: Long,
        @Body req: NoteUpsertRequest,
        @Header("If-Match") ifMatch: String? = null,
    ): Response<UpdateNoteResponse>

    @DELETE("api/notes/{id}")
    suspend fun deleteNote(@Path("id") id: Long): Response<Unit>

    @POST("api/notes/{id}/pin")
    suspend fun togglePin(@Path("id") id: Long): Response<PinResponse>

    @GET("api/notes/search")
    suspend fun search(@Query("q") query: String, @Query("limit") limit: Int = 50): Response<SearchResponse>

    @GET("api/notes/{id}/links")
    suspend fun links(@Path("id") id: Long): Response<LinksResponse>

    @GET("api/notes/{id}/versions")
    suspend fun versions(@Path("id") id: Long): Response<List<NoteVersionSummary>>

    @GET("api/notes/{id}/versions/{vid}")
    suspend fun version(@Path("id") id: Long, @Path("vid") versionId: Long): Response<NoteVersion>

    @GET("api/notes/stats")
    suspend fun stats(): Response<StatsResponse>

    // ---- trash -------------------------------------------------------------

    @GET("api/notes/trash")
    suspend fun trash(): Response<List<TrashedNote>>

    @POST("api/notes/{id}/restore")
    suspend fun restoreNote(@Path("id") id: Long): Response<Unit>

    @DELETE("api/notes/{id}/purge")
    suspend fun purgeNote(@Path("id") id: Long): Response<Unit>

    @DELETE("api/notes/trash")
    suspend fun emptyTrash(): Response<PurgeResponse>

    // ---- journal and templates --------------------------------------------

    // The entry for one day, or 404 when that day has none.
    @GET("api/notes/daily")
    suspend fun dailyNote(@Query("date") date: String? = null): Response<Note>

    @POST("api/notes/daily")
    suspend fun openDaily(@Body req: DailyRequest): Response<DailyResponse>

    @GET("api/notes/daily/list")
    suspend fun dailyEntries(): Response<List<DailyEntry>>

    @GET("api/templates")
    suspend fun templates(): Response<List<Template>>

    @POST("api/templates")
    suspend fun createTemplate(@Body req: Template): Response<CreateNoteResponse>

    @PUT("api/templates/{id}")
    suspend fun updateTemplate(@Path("id") id: Long, @Body req: Template): Response<Unit>

    @DELETE("api/templates/{id}")
    suspend fun deleteTemplate(@Path("id") id: Long): Response<Unit>

    @POST("api/templates/{id}/apply")
    suspend fun applyTemplate(@Path("id") id: Long, @Body req: ApplyTemplateRequest): Response<CreateNoteResponse>

    // ---- tags and folders --------------------------------------------------

    @GET("api/tags")
    suspend fun tags(): Response<List<TagCount>>

    @PUT("api/tags/{name}")
    suspend fun renameTag(@Path("name", encoded = true) name: String, @Body req: RenameRequest): Response<TagMutationResponse>

    @POST("api/tags/merge")
    suspend fun mergeTags(@Body req: MergeTagsRequest): Response<TagMutationResponse>

    @DELETE("api/tags/{name}")
    suspend fun deleteTag(@Path("name", encoded = true) name: String): Response<TagMutationResponse>

    @GET("api/folders")
    suspend fun folders(): Response<List<Folder>>

    @PUT("api/folders")
    suspend fun renameFolder(@Body req: MoveFolderRequest): Response<FolderMutationResponse>

    @DELETE("api/folders")
    suspend fun deleteFolder(@Query("path") path: String): Response<FolderMutationResponse>

    // ---- sharing and images ------------------------------------------------

    @POST("api/notes/{id}/share")
    suspend fun enableShare(@Path("id") id: Long, @Body req: ShareRequest): Response<ShareResponse>

    @POST("api/notes/{id}/share/disable")
    suspend fun disableShare(@Path("id") id: Long): Response<Unit>

    @PUT("api/notes/{id}/share/password")
    suspend fun setSharePassword(@Path("id") id: Long, @Body req: SharePasswordRequest): Response<Unit>

    @PUT("api/notes/{id}/share/expiry")
    suspend fun setShareExpiry(@Path("id") id: Long, @Body req: ShareExpiryRequest): Response<Unit>

    /**
     * Reads a note someone shared. The link is the credential, so this is the
     * one call that needs no session — a password only if the link has one.
     */
    @GET("api/share/{token}")
    suspend fun sharedNote(
        @Path("token") token: String,
        @Header("X-Share-Password") password: String? = null,
    ): Response<Note>

    @Multipart
    @POST("api/images")
    suspend fun uploadImage(@Part file: MultipartBody.Part): Response<ImageUploadResponse>

    @GET("api/notes/export")
    suspend fun exportAll(): Response<ResponseBody>

    @Multipart
    @POST("api/notes/import")
    suspend fun importNotes(@Part file: MultipartBody.Part): Response<ImportResponse>
}
